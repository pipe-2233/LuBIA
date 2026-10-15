import { Router } from "express";
import { ImapFlow } from "imapflow";
import { join } from "node:path";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { getSetting } from "../config/env.js";

const router = Router();

function countEmls(dir) {
  let count = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      try {
        if (statSync(p).isDirectory()) count += countEmls(p);
        else if (entry.endsWith(".eml")) count++;
      } catch {}
    }
  } catch {}
  return count;
}

// ── Explorar correos archivados en disco ────────────────
router.get("/correos/browse", (req, res) => {
  try {
    const ruta = req.query.ruta || getSetting("RUTA_CORREOS") || "/mnt/correos";
    const subPath = req.query.path || "";
    const search = (req.query.search || "").toLowerCase();
    const fullPath = join(ruta, subPath);

    if (!existsSync(fullPath)) {
      return res.json({ folders: [], files: [], path: subPath, ruta });
    }

    const entries = readdirSync(fullPath);
    const folders = [];
    const files = [];

    for (const name of entries) {
      const itemPath = join(fullPath, name);
      try {
        const stat = statSync(itemPath);
        if (stat.isDirectory()) {
          const count = countEmls(itemPath);
          folders.push({ name, count, path: subPath ? `${subPath}/${name}` : name });
        } else if (name.endsWith(".eml")) {
          const parts = name.replace(".eml", "").split("_");
          const fecha = parts[0] || "";
          const asunto = parts.slice(1, -1).join("_") || name;
          const sizeKB = (stat.size / 1024).toFixed(1);
          const baseName = name;

          if (search) {
            if (asunto.toLowerCase().includes(search) || baseName.toLowerCase().includes(search)) {
              files.push({ name: baseName, fecha, asunto: decodeURIComponent(asunto).slice(0, 80), sizeKB, path: subPath });
            }
          } else {
            files.push({ name: baseName, fecha, asunto: decodeURIComponent(asunto).slice(0, 80), sizeKB, path: subPath });
          }
        }
      } catch {}
    }

    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => b.fecha.localeCompare(a.fecha));

    res.json({ folders, files, path: subPath, ruta });
  } catch (err) {
    console.error("[Correos Browse]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Leer correo .eml ───────────────────────────────────
router.get("/correos/read", (req, res) => {
  try {
    const ruta = req.query.ruta || getSetting("RUTA_CORREOS") || "/mnt/correos";
    const file = req.query.file;
    if (!file) return res.status(400).json({ error: "Falta el nombre del archivo" });

    const fullPath = join(ruta, file);
    if (!existsSync(fullPath)) return res.status(404).json({ error: "Archivo no encontrado" });

    const raw = readFileSync(fullPath, "utf-8");
    const headerEnd = raw.indexOf("\r\n\r\n");
    const headerSection = headerEnd > 0 ? raw.slice(0, headerEnd) : raw.split("\n\n")[0] || raw.slice(0, 1000);
    const body = headerEnd > 0 ? raw.slice(headerEnd + 4) : "";

    const headers = {};
    for (const line of headerSection.split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        headers[key] = line.slice(idx + 1).trim();
      }
    }

    res.json({
      from: headers["From"] || "",
      to: headers["To"] || "",
      subject: headers["Subject"] || "",
      date: headers["Date"] || "",
      body: body.slice(0, 5000),
    });
  } catch (err) {
    console.error("[Correos Read]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Archivar correos cPanel/IMAP a disco ────────────────
router.post("/correos/archivar", async (req, res) => {
  try {
    const {
      imapHost,
      imapPort = 993,
      imapUser,
      imapPass,
      antiguedad = 12,
      rutaArchivo,
      borrarDespues = false,
    } = req.body;

    if (!imapHost || !imapUser || !imapPass) {
      return res.status(400).json({ error: "Faltan datos IMAP" });
    }

    const ruta = rutaArchivo || getSetting("RUTA_CORREOS") || "/mnt/correos";
    const corte = new Date();
    corte.setMonth(corte.getMonth() - (antiguedad || 12));

    const client = new ImapFlow({
      host: imapHost,
      port: Number(imapPort) || 993,
      secure: true,
      auth: { user: imapUser, pass: imapPass },
      logger: false,
    });

    let totalArchivados = 0;
    let totalFallidos = 0;
    let totalPendientes = 0;
    let totalBytes = 0;
    console.log(`[Correos] Conectando a ${imapHost}...`);
    await client.connect();

    const folderList = await client.list();
    for (const f of folderList) {
      try {
        await client.mailboxOpen(f.path);
        // Se trabaja con UID (identificador estable): los números de secuencia se corren al borrar
        const found = await client.search({ before: corte }, { uid: true });
        if (!found.length) continue;
        console.log(`[Correos] ${f.path}: ${found.length} correos`);

        const lote = found.slice(0, 500);
        totalPendientes += found.length - lote.length;
        for (const seq of lote) {
          try {
            const msg = await client.fetchOne(seq, { envelope: true, source: true }, { uid: true });
            const d = msg.envelope.date || new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const from = (msg.envelope.from || [{ address: "desconocido@mail.com" }])[0]?.address || "desconocido";
            const sub = (msg.envelope.subject || "sin-asunto").replace(/[^a-zA-Z0-9\u00C0-\u024F _-]/g, "_").slice(0, 60);

            const dir = join(ruta, String(y), m, from.replace(/[^a-zA-Z0-9@._-]/g, "_"));
            mkdirSync(dir, { recursive: true });
            const fname = `${d.toISOString().split("T")[0]}_${sub}_${seq}.eml`.replace(/[/\\?%*:|"<>]/g, "_");
            writeFileSync(join(dir, fname), msg.source);
            totalArchivados++;
            totalBytes += msg.source.length;
            // Solo se borra del buzón si el archivo ya quedó escrito en disco
            if (borrarDespues) await client.messageDelete(seq, { uid: true });
          } catch (e) {
            totalFallidos++;
            console.log(`[Correos] Falló UID ${seq} en ${f.path}: ${e.message}`);
          }
        }
      } catch (e) {
        console.log(`[Correos] Error en ${f.path}: ${e.message}`);
      }
    }

    await client.logout();
    console.log(`[Correos] ${totalArchivados} correos archivados, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    res.json({
      totalArchivados,
      espacioEstimadoMB: +(totalBytes / 1024 / 1024).toFixed(1),
      fallidos: totalFallidos,
      pendientes: totalPendientes,
      ruta,
    });
  } catch (err) {
    console.error("[Correos Archivar]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
