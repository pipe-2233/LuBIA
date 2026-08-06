import "dotenv/config";
import express from "express";
import multer from "multer";
import { createClient } from "@deepgram/sdk";
import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { createClient as createSupabase } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const EXPORT_DIR = join(__dirname, "exports");
const DATA_DIR = join(__dirname, "data");
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(EXPORT_DIR, { recursive: true });

// ── Supabase ────────────────────────────────────────────
let supabase = null, settingsCache = {};
function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL || settingsCache.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY || settingsCache.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL o SUPABASE_ANON_KEY no configurados");
    supabase = createSupabase(url, key);
  }
  return supabase;
}

async function loadSettingsCache() {
  try {
    const sb = createSupabase(process.env.SUPABASE_URL || "", process.env.SUPABASE_ANON_KEY || "");
    const { data } = await sb.from("settings").select("*");
    for (const r of (data || [])) settingsCache[r.key] = r.value;
  } catch { /* Supabase no configurado aún */ }
}
await loadSettingsCache();

function getSetting(key) {
  return settingsCache[key] || process.env[key] || "";
}

async function saveSettingsToDB(updates) {
  const sb = getSupabase();
  for (const [key, value] of Object.entries(updates)) {
    await sb.from("settings").upsert({ key, value }).select().maybeSingle();
    settingsCache[key] = value;
  }
}

// ── Deepgram / Claude lazy ────────────────────────────
let _deepgram = null, _claude = null;
function getDeepgram() {
  if (!_deepgram) _deepgram = createClient(getSetting("DEEPGRAM_API_KEY"));
  return _deepgram;
}
function getClaude() {
  if (!_claude) _claude = new Anthropic({ apiKey: getSetting("CLAUDE_API_KEY") });
  return _claude;
}

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// ── Proyectos (Supabase) ──────────────────────────────
app.get("/api/projects", async (_req, res) => {
  try {
    const { data } = await getSupabase().from("projects").select("*").order("created_at", { ascending: false });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data } = await getSupabase().from("projects").insert({ name }).select().single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Settings ───────────────────────────────────────────
app.get("/api/settings", async (_req, res) => {
  try {
    const { data } = await getSupabase().from("settings").select("*");
    const obj = {};
    for (const r of (data || [])) obj[r.key] = r.value;
    res.json(obj);
  } catch { res.json({}); }
});

app.post("/api/settings", async (req, res) => {
  const allowed = ["DEEPGRAM_API_KEY", "CLAUDE_API_KEY", "GMAIL_USER", "GMAIL_PASS", "EMAIL_TO", "OLLAMA_MODEL", "RUTA_CORREOS", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  try {
    await saveSettingsToDB(updates);
    _deepgram = null;
    _claude = null;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Archivos y carpetas del proyecto ──────────────────
function projectDir(projectId) {
  const dir = join(DATA_DIR, "projects", projectId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

app.get("/api/projects/:id/files", async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: folders } = await sb.from("folders").select("*").eq("project_id", req.params.id);
    const { data: files } = await sb.from("files").select("*").eq("project_id", req.params.id);
    res.json({ folders: folders || [], files: files || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects/:id/folders", async (req, res) => {
  const { name, parentId } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const sb = getSupabase();
    const { data } = await sb.from("folders").insert({
      project_id: req.params.id, name, parent_id: parentId || null,
    }).select().single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/projects/:id/folders/:folderId", async (req, res) => {
  try {
    const sb = getSupabase();
    await sb.from("files").update({ folder_id: null }).eq("folder_id", req.params.folderId);
    await sb.from("folders").delete().eq("id", req.params.folderId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const fileUpload = multer({ storage: multer.diskStorage({
  destination: (req, _file, cb) => cb(null, projectDir(req.params.id)),
  filename: (_req, file, cb) => cb(null, "f_" + randomUUID() + "_" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")),
}), limits: { fileSize: 50 * 1024 * 1024 } });

app.post("/api/projects/:id/files", fileUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió archivo" });
  try {
    const sb = getSupabase();
    const { data } = await sb.from("files").insert({
      project_id: req.params.id, folder_id: req.body.folderId || null,
      name: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size,
    }).select().single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/projects/:id/files/:fileId", async (req, res) => {
  try {
    const sb = getSupabase();
    await sb.from("files").delete().eq("id", req.params.fileId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Transcribir audio ──────────────────────────────────
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No se recibió audio" });

    const { result, error } = await getDeepgram().listen.prerecorded.transcribeFile(
      req.file.buffer,
      {
        model: "nova-3",
        smart_format: true,
        diarize: true,
        detect_language: true,
        punctuate: true,
      }
    );

    if (error) return res.status(500).json({ error: error.message });

    const paragraphs = result.results.channels[0]?.alternatives[0]?.paragraphs?.paragraphs || [];
    let text = "";
    const segments = [];
    for (const p of paragraphs) {
      const speaker = p.speaker ?? 0;
      const txt = p.sentences.map((s) => s.text).join(" ");
      text += `[Speaker ${speaker}]: ${txt}\n`;
      segments.push({ speaker, text: txt, start: p.start, end: p.end });
    }

    if (!text) {
      const alt = result.results.channels[0]?.alternatives[0]?.transcript || "";
      text = alt;
      segments.push({ speaker: 0, text: alt, start: 0, end: 0 });
    }

    console.log(`[Deepgram] ${segments.length} segmentos, ${text.length} chars`);
    res.json({ transcription: text.trim(), segments });
  } catch (err) {
    console.error("[Transcribe]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Claude: Extraer datos estructurados ──────────────────
app.post("/api/extraer", async (req, res) => {
  try {
    const { transcription, template } = req.body;
    if (!transcription) return res.status(400).json({ error: "Falta transcripción" });

    const templatePrompt = getTemplatePrompt(template || "ruta_lubricacion");

    const msg = await getClaude().messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      system: templatePrompt,
      messages: [{ role: "user", content: `Extrae los datos de este audio de campo:\n\n${transcription}` }],
    });

    const content = msg.content[0]?.text || "{}";
    const jsonText = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const brace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    const clean = jsonText.slice(brace >= 0 ? brace : 0, lastBrace >= 0 ? lastBrace + 1 : undefined);

    let data;
    try { data = JSON.parse(clean); } catch { data = { error: "No se pudo parsear", raw: content }; }

    console.log("[Claude] Extracción OK");
    res.json(data);
  } catch (err) {
    console.error("[Extraer]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Generar Excel ──────────────────────────────────────
app.post("/api/generar-excel", async (req, res) => {
  try {
    const { data, template } = req.body;
    if (!data) return res.status(400).json({ error: "Faltan datos" });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Ruta de Lubricación");

    sheet.columns = [
      { header: "Activo", key: "activo", width: 25 },
      { header: "Componente", key: "componente", width: 25 },
      { header: "Cantidad", key: "cantidad", width: 12 },
      { header: "Lubricante", key: "lubricante", width: 20 },
      { header: "Frecuencia", key: "frecuencia", width: 18 },
      { header: "Ubicación", key: "ubicacion", width: 20 },
      { header: "Observaciones", key: "observaciones", width: 30 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAB308" } };
      cell.font = { bold: true, color: { argb: "FF111827" }, size: 12 };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });

    const componentes = data.componentes || [];
    let rowIdx = 2;
    for (const comp of componentes) {
      const row = sheet.getRow(rowIdx);
      row.getCell(1).value = data.activo || "";
      row.getCell(2).value = comp.nombre || "";
      row.getCell(3).value = comp.cantidad || "";
      row.getCell(4).value = comp.lubricante || "";
      row.getCell(5).value = comp.frecuencia || data.frecuencia || "";
      row.getCell(6).value = comp.ubicacion || data.ubicacion || "";
      row.getCell(7).value = comp.observaciones || data.observaciones || "";
      row.eachCell((cell) => {
        cell.font = { size: 11 };
        cell.alignment = { vertical: "middle" };
        cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      });
      rowIdx++;
    }

    const filename = `ruta_lubricacion_${Date.now()}.xlsx`;
    const filepath = join(EXPORT_DIR, filename);
    await workbook.xlsx.writeFile(filepath);

    console.log(`[Excel] Generado: ${filename}`);
    res.download(filepath, filename);
  } catch (err) {
    console.error("[Excel]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Plantillas ─────────────────────────────────────────
function getTemplatePrompt(type) {
  const templates = {
    ruta_lubricacion: `Eres un asistente técnico de INGELUBSA S.A.S., especialista en lubricación industrial.
Tu tarea es extraer datos estructurados de audios de campo de ingenieros.

Debes devolver ÚNICAMENTE un objeto JSON con este formato:
{
  "activo": "Nombre del equipo/activo",
  "componentes": [
    { "nombre": "Componente", "cantidad": "unidades", "lubricante": "tipo", "frecuencia": "", "ubicacion": "", "observaciones": "" }
  ],
  "faltantes": ["lista de datos que faltan y son necesarios"],
  "preguntas": ["preguntas concretas para completar los faltantes"]
}

Reglas:
- Extrae TODO lo mencionado en el audio
- Si un dato no se menciona, déjalo como string vacío ""  
- Los faltantes son solo los datos CRÍTICOS que impiden completar la ficha
- Las preguntas deben ser claras y técnicas, en español
- Lubricantes comunes: VG EP 2, ISO VG 220, ISO VG 68, ISO VG 150, GRASA EP 2
- IMPORTANTE: solo el JSON, sin texto adicional`,

    levantamiento: `Eres un asistente técnico de INGELUBSA S.A.S.
Extrae datos de levantamiento de muestras. Devuelve SOLO JSON:
{
  "activo": "",
  "tipoMuestra": "",
  "puntoExtraccion": "",
  "componentes": [],
  "faltantes": [],
  "preguntas": []
}`,

    prueba_tecnica: `Eres un asistente técnico de INGELUBSA S.A.S.
Extrae datos de pruebas técnicas. Devuelve SOLO JSON:
{
  "activo": "",
  "tipoPrueba": "",
  "resultado": "",
  "norma": "",
  "componentes": [],
  "faltantes": [],
  "preguntas": []
}`
  };

  return templates[type] || templates.ruta_lubricacion;
}

// ── Correos: explorador y archivo ──────────────────────

app.get("/api/correos/browse", (req, res) => {
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
          folders.push({ name, count, path: subPath ? subPath + "/" + name : name });
        } else if (name.endsWith(".eml")) {
          // Parseo rápido del asunto y remitente del nombre de archivo
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
    res.status(500).json({ error: err.message });
  }
});

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

app.get("/api/correos/read", (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// Archivar: IMAP → disco (se mantiene igual)
app.post("/api/correos/archivar", async (req, res) => {
  try {
    const { imapHost, imapPort = 993, imapUser, imapPass, antiguedad = 12, rutaArchivo, borrarDespues = false } = req.body;
    if (!imapHost || !imapUser || !imapPass) return res.status(400).json({ error: "Faltan datos IMAP" });
    const ruta = rutaArchivo || getSetting("RUTA_CORREOS") || "/mnt/correos";

    const corte = new Date();
    corte.setMonth(corte.getMonth() - (antiguedad || 12));

    const client = new ImapFlow({
      host: imapHost, port: imapPort || 993, secure: true,
      auth: { user: imapUser, pass: imapPass }, logger: false,
    });

    let totalArchivados = 0, totalBytes = 0;
    console.log(`[Correos] Conectando a ${imapHost}...`);
    await client.connect();

    const folderList = await client.list();
    for (const f of folderList) {
      try {
        await client.mailboxOpen(f.path);
        const found = await client.search({ before: corte });
        if (!found.length) continue;
        console.log(`[Correos] ${f.path}: ${found.length} correos`);

        for (const seq of found.slice(0, 500)) {
          try {
            const msg = await client.fetchOne(seq, { envelope: true, source: true });
            const d = msg.envelope.date || new Date();
            const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0");
            const from = (msg.envelope.from || [{ address: "desconocido@mail.com" }])[0]?.address || "desconocido";
            const sub = (msg.envelope.subject || "sin-asunto").replace(/[^a-zA-Z0-9\u00C0-\u024F _-]/g, "_").slice(0, 60);

            const dir = join(ruta, String(y), m, from.replace(/[^a-zA-Z0-9@._-]/g, "_"));
            mkdirSync(dir, { recursive: true });
            const fname = `${d.toISOString().split("T")[0]}_${sub}_${seq}.eml`.replace(/[/\\?%*:|"<>]/g, "_");
            writeFileSync(join(dir, fname), msg.source);
            totalArchivados++; totalBytes += msg.source.length;
            if (borrarDespues) await client.messageDelete(seq);
          } catch {}
        }
      } catch (e) { console.log(`[Correos] Error ${f.path}: ${e.message}`); }
    }

    await client.logout();
    console.log(`[Correos] ${totalArchivados} correos, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    res.json({ totalArchivados, espacioEstimadoMB: +(totalBytes / 1024 / 1024).toFixed(1), ruta });
  } catch (err) {
    console.error("[Correos]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Iniciar ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`LUBIA corriendo en http://localhost:${PORT}`);
  console.log(`Datos en: ${DATA_DIR}`);
});
