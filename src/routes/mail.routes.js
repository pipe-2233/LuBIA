import { Router } from "express";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { randomBytes } from "node:crypto";

// Buzón en vivo: inicia sesión por IMAP y muestra los correos sin archivarlos.
// Las credenciales viven SOLO en la memoria del servidor (nunca en disco) y la sesión
// caduca tras 30 min sin uso. Todo se abre en modo solo-lectura: no marca como leído ni borra.
const router = Router();
const sesiones = new Map(); // token -> { host, port, user, pass, ultimo }
const TTL_MS = 30 * 60 * 1000;
const PAGINA = 30;

setInterval(() => {
  const ahora = Date.now();
  for (const [t, s] of sesiones) if (ahora - s.ultimo > TTL_MS) sesiones.delete(t);
}, 60 * 1000).unref();

function nuevoCliente(s) {
  return new ImapFlow({
    host: s.host,
    port: s.port,
    secure: s.port === 993,
    auth: { user: s.user, pass: s.pass },
    logger: false,
    socketTimeout: 30000,
  });
}

function sesionDe(req, res) {
  const t = req.get("x-mail-session");
  const s = t && sesiones.get(t);
  if (!s) {
    res.status(401).json({ error: "Sesión de correo vencida. Inicia sesión de nuevo." });
    return null;
  }
  s.ultimo = Date.now();
  return s;
}

async function conImap(s, fn) {
  const client = nuevoCliente(s);
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try { await client.logout(); } catch {}
  }
}

// Carpetas con cantidad de no leídos (solo lectura: STATUS no modifica nada)
async function listarCarpetas(c) {
  const l = await c.list();
  const out = [];
  for (const f of l) {
    let sinLeer = 0;
    if (!f.flags?.has("\\Noselect")) {
      try { sinLeer = (await c.status(f.path, { unseen: true })).unseen || 0; } catch {}
    }
    out.push({ path: f.path, name: f.name, especial: f.specialUse || "", sinLeer });
  }
  return out;
}

// Spam: marcas de SpamAssassin (cPanel) o banderas del servidor
function esSpam(m) {
  const h = m.headers ? m.headers.toString("utf8").toLowerCase() : "";
  if (/x-spam-flag:\s*yes/.test(h) || /x-spam-status:\s*yes/.test(h)) return true;
  for (const f of ["$junk", "junk", "$phishing"]) if ([...(m.flags || [])].some((x) => x.toLowerCase() === f)) return true;
  return false;
}

const dir = (a) => (a ? `${a.name ? a.name + " " : ""}<${a.address || ""}>`.trim() : "");
function tieneAdjuntos(node) {
  if (!node) return false;
  if (node.disposition && node.disposition.toLowerCase() === "attachment") return true;
  return (node.childNodes || []).some(tieneAdjuntos);
}

// ── Iniciar sesión ──────────────────────────────────────
router.post("/mail/login", async (req, res) => {
  const { host, user, pass } = req.body || {};
  const port = Number(req.body?.port) || 993;
  if (!host || !user || !pass) return res.status(400).json({ error: "Faltan servidor, usuario o contraseña" });
  const s = { host: String(host).trim(), port, user: String(user).trim(), pass: String(pass), ultimo: Date.now() };
  try {
    const carpetas = await conImap(s, listarCarpetas);
    const token = randomBytes(24).toString("hex");
    sesiones.set(token, s);
    res.json({ token, user: s.user, carpetas });
  } catch (e) {
    const auth = e.authenticationFailed || /auth|login|credentials/i.test(e.message || "");
    res.status(auth ? 401 : 502).json({
      error: auth ? "Usuario o contraseña incorrectos" : `No se pudo conectar con ${s.host}: ${e.message}`,
    });
  }
});

router.get("/mail/folders", async (req, res) => {
  const s = sesionDe(req, res);
  if (!s) return;
  try {
    res.json({ carpetas: await conImap(s, listarCarpetas) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post("/mail/logout", (req, res) => {
  sesiones.delete(req.get("x-mail-session"));
  res.json({ ok: true });
});

// ── Lista de mensajes de una carpeta (más recientes primero) ──
router.get("/mail/messages", async (req, res) => {
  const s = sesionDe(req, res);
  if (!s) return;
  const carpeta = req.query.folder || "INBOX";
  const pagina = Math.max(1, Number(req.query.page) || 1);
  const q = String(req.query.q || "").trim();
  try {
    const out = await conImap(s, async (c) => {
      const lock = await c.getMailboxLock(carpeta, { readOnly: true });
      try {
        let rango, opts = {}, total;
        if (q) {
          const uids = await c.search({ or: [{ subject: q }, { from: q }, { to: q }] }, { uid: true });
          total = uids.length;
          const fin = total - (pagina - 1) * PAGINA;
          const sel = uids.slice(Math.max(0, fin - PAGINA), Math.max(0, fin));
          if (!sel.length) return { total, mensajes: [] };
          rango = sel;
          opts = { uid: true };
        } else {
          total = c.mailbox.exists;
          const fin = total - (pagina - 1) * PAGINA;
          if (fin < 1) return { total, mensajes: [] };
          rango = `${Math.max(1, fin - PAGINA + 1)}:${fin}`;
        }
        const mensajes = [];
        for await (const m of c.fetch(rango, { uid: true, envelope: true, flags: true, bodyStructure: true, headers: ["x-spam-flag", "x-spam-status"] }, opts)) {
          mensajes.push({
            uid: m.uid,
            asunto: m.envelope?.subject || "(sin asunto)",
            de: dir(m.envelope?.from?.[0]),
            nombre: m.envelope?.from?.[0]?.name || m.envelope?.from?.[0]?.address || "Desconocido",
            correo: m.envelope?.from?.[0]?.address || "",
            spam: esSpam(m),
            fecha: m.envelope?.date || null,
            leido: m.flags?.has("\\Seen") || false,
            adjuntos: tieneAdjuntos(m.bodyStructure),
          });
        }
        mensajes.sort((a, b) => b.uid - a.uid);
        return { total, mensajes };
      } finally {
        lock.release();
      }
    });
    res.json({ ...out, pagina, porPagina: PAGINA });
  } catch (e) {
    console.error("[Mail messages]", e.message);
    res.status(502).json({ error: e.message });
  }
});

async function leerParseado(s, carpeta, uid) {
  return conImap(s, async (c) => {
    const lock = await c.getMailboxLock(carpeta, { readOnly: true });
    try {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg?.source) return null;
      return await simpleParser(msg.source);
    } finally {
      lock.release();
    }
  });
}

// ── Leer un mensaje ───────────────────────────────────────
router.get("/mail/message", async (req, res) => {
  const s = sesionDe(req, res);
  if (!s) return;
  try {
    const p = await leerParseado(s, req.query.folder || "INBOX", req.query.uid);
    if (!p) return res.status(404).json({ error: "Mensaje no encontrado" });

    let html = p.html || "";
    if (html) {
      // Imágenes incrustadas (cid:) -> data URI. Las imágenes remotas quedan bloqueadas en el cliente.
      for (const a of p.attachments || []) {
        if (a.cid && a.size < 3 * 1024 * 1024) {
          html = html.split(`cid:${a.cid}`).join(`data:${a.contentType};base64,${a.content.toString("base64")}`);
        }
      }
    }
    res.json({
      spam: /^yes/i.test(String(p.headers?.get("x-spam-flag") || "")) || /^yes/i.test(String(p.headers?.get("x-spam-status") || "")),
      nombre: p.from?.value?.[0]?.name || p.from?.value?.[0]?.address || "Desconocido",
      correo: p.from?.value?.[0]?.address || "",
      de: p.from?.text || "",
      para: p.to?.text || "",
      cc: p.cc?.text || "",
      asunto: p.subject || "(sin asunto)",
      fecha: p.date || null,
      html,
      texto: p.text || "",
      adjuntos: (p.attachments || []).map((a, i) => ({ i, nombre: a.filename || `adjunto-${i + 1}`, tipo: a.contentType, tamano: a.size })),
    });
  } catch (e) {
    console.error("[Mail message]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── Descargar un adjunto ──────────────────────────────────
router.get("/mail/attachment", async (req, res) => {
  const s = sesionDe(req, res);
  if (!s) return;
  try {
    const p = await leerParseado(s, req.query.folder || "INBOX", req.query.uid);
    const a = p?.attachments?.[Number(req.query.i)];
    if (!a) return res.status(404).json({ error: "Adjunto no encontrado" });
    const nombre = (a.filename || "adjunto").replace(/[\r\n"]/g, "_");
    res.setHeader("Content-Type", a.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`);
    res.send(a.content);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
