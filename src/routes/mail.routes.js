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
    const carpetas = await conImap(s, async (c) => {
      const l = await c.list();
      return l.map((f) => ({ path: f.path, name: f.name, especial: f.specialUse || "" }));
    });
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
    const carpetas = await conImap(s, async (c) => (await c.list()).map((f) => ({ path: f.path, name: f.name, especial: f.specialUse || "" })));
    res.json({ carpetas });
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
        for await (const m of c.fetch(rango, { uid: true, envelope: true, flags: true, bodyStructure: true }, opts)) {
          mensajes.push({
            uid: m.uid,
            asunto: m.envelope?.subject || "(sin asunto)",
            de: dir(m.envelope?.from?.[0]),
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
