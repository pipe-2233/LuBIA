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
import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const EXPORT_DIR = join(__dirname, "exports");
const DATA_DIR = join(__dirname, "data");
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(EXPORT_DIR, { recursive: true });

// ── Supabase ────────────────────────────────────────────
let _supabase = null;
function getSupabaseAdmin() {
  if (!_supabase) {
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    _supabase = createSupabase(process.env.SUPABASE_URL, key);
  }
  return _supabase;
}

function getSetting(key) {
  // API keys siempre del .env (Render). Solo RUTA_CORREOS puede venir de Supabase.
  const envKeys = ["DEEPGRAM_API_KEY", "CLAUDE_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY",
    "GMAIL_USER", "GMAIL_PASS", "EMAIL_TO", "OLLAMA_MODEL"];
  if (envKeys.includes(key)) return process.env[key] || "";
  return process.env[key] || "";
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
    const { data } = await getSupabaseAdmin().from("projects").select("*").order("created_at", { ascending: false });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data } = await getSupabaseAdmin().from("projects").insert({ name }).select().single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Settings ───────────────────────────────────────────
app.get("/api/settings", async (_req, res) => {
  try {
    const { data } = await getSupabaseAdmin().from("settings").select("*");
    const obj = {};
    for (const r of (data || [])) obj[r.key] = r.value;
    // Agregar las de process.env para que el frontend las vea
    obj.SUPABASE_URL = obj.SUPABASE_URL || process.env.SUPABASE_URL || "";
    res.json(obj);
  } catch { res.json({}); }
});

app.post("/api/settings", async (req, res) => {
  try {
    // Solo guardar en Supabase los valores no sensibles (RUTA_CORREOS)
    const saveableKeys = ["RUTA_CORREOS"];
    for (const key of saveableKeys) {
      if (req.body[key] !== undefined) {
        await getSupabaseAdmin().from("settings").upsert({ key, value: req.body[key] });
      }
    }
    _deepgram = null; _claude = null;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sedes del proyecto ─────────────────────────────────
app.get("/api/projects/:id/sedes", async (req, res) => {
  try {
    const { data } = await getSupabaseAdmin().from("sedes").select("*").eq("project_id", req.params.id).order("created_at");
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects/:id/sedes", async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data } = await getSupabaseAdmin().from("sedes").insert({
      project_id: req.params.id, name, description: description || "",
    }).select().single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/projects/:id/sedes/:sedeId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    await sb.from("files").delete().eq("sede_id", req.params.sedeId);
    await sb.from("folders").delete().eq("sede_id", req.params.sedeId);
    await sb.from("sedes").delete().eq("id", req.params.sedeId);
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
    const sb = getSupabaseAdmin(), sedeId = req.query.sede_id || null, filterType = req.query.type || null;
    let qF = sb.from("folders").select("*").eq("project_id", req.params.id);
    let qFi = sb.from("files").select("*").eq("project_id", req.params.id);
    if (sedeId) { qF = qF.eq("sede_id", sedeId); qFi = qFi.eq("sede_id", sedeId); }
    if (filterType === "image") qFi = qFi.ilike("mimetype", "image/%");
    const [{ data: folders }, { data: files }] = await Promise.all([qF, qFi]);
    res.json({ folders: folders || [], files: files || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects/:id/folders", async (req, res) => {
  const { name, parentId, sedeId } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data } = await getSupabaseAdmin().from("folders").insert({
      project_id: req.params.id, name, parent_id: parentId || null, sede_id: sedeId || null,
    }).select().single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/projects/:id/folders/:folderId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    await sb.from("files").delete().eq("folder_id", req.params.folderId);
    await sb.from("folders").delete().eq("id", req.params.folderId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.post("/api/projects/:id/files", fileUpload.array("files", 20), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "No se recibieron archivos" });
  try {
    const sb = getSupabaseAdmin();
    const results = [];
    for (const file of req.files) {
      const { data } = await sb.from("files").insert({
        project_id: req.params.id, folder_id: req.body.folderId || null,
        sede_id: req.body.sedeId || null,
        name: file.originalname, mimetype: file.mimetype, size: file.size,
      }).select().single();
      const storagePath = `${req.params.id}/${data.id}`;
      const { error: uploadErr } = await sb.storage.from("lubia-files").upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true, cacheControl: "0" });
      if (uploadErr) {
        await sb.from("files").delete().eq("id", data.id);
        console.error("[Upload] Error Storage:", uploadErr);
      } else {
        results.push(data);
        console.log(`[Upload] OK: ${file.originalname} (${file.size} bytes)`);
      }
    }
    res.json({ count: results.length, files: results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/projects/:id/files/:fileId", async (req, res) => {
  try {
    await getSupabaseAdmin().from("files").delete().eq("id", req.params.fileId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/projects/:id/files/:fileId", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data } = await getSupabaseAdmin().from("files").update({ name }).eq("id", req.params.fileId).eq("project_id", req.params.id).select().single();
    res.json(data || { ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/projects/:id/files/:fileId/move", async (req, res) => {
  try {
    await getSupabaseAdmin().from("files").update({ folder_id: req.body.folderId || null }).eq("id", req.params.fileId).eq("project_id", req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Visualizar archivo ────────────────────────────────
app.get("/api/projects/:id/files/:fileId/view", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data: file } = await sb.from("files").select("*").eq("id", req.params.fileId).single();
    if (!file) return res.status(404).json({ error: "Archivo no encontrado en BD" });
    const storagePath = `${file.project_id}/${file.id}`;
    // Bucket público: usar URL pública
    const { data: urlData } = sb.storage.from("lubia-files").getPublicUrl(storagePath);
    if (urlData?.publicUrl) return res.redirect(urlData.publicUrl);

    // Fallback: signed URL
    const { data: signed } = await sb.storage.from("lubia-files").createSignedUrl(storagePath, 3600);
    if (signed?.signedUrl) return res.redirect(signed.signedUrl);

    res.status(404).json({ error: `Archivo no encontrado en Storage: ${storagePath}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Transcribir archivo de audio del proyecto ─────────
app.post("/api/transcribe-file/:fileId", async (req, res) => {
  try {
    const { data: file } = await getSupabaseAdmin().from("files").select("*").eq("id", req.params.fileId).single();
    if (!file) return res.status(404).json({ error: "Archivo no encontrado" });
    const sb = getSupabaseAdmin();
    const storagePath = `${file.project_id}/${file.id}`;
    const { data: dl } = await sb.storage.from("lubia-files").download(storagePath);
    if (!dl) return res.status(404).json({ error: "Archivo no encontrado en Storage" });
    const buf = Buffer.from(await dl.arrayBuffer());

    const { result, error } = await getDeepgram().listen.prerecorded.transcribeFile(buf, {
      model: "nova-3", smart_format: true, diarize: true, detect_language: true, punctuate: true,
    });
    if (error) return res.status(500).json({ error: error.message });
    const paragraphs = result.results.channels[0]?.alternatives[0]?.paragraphs?.paragraphs || [];
    let text = ""; const segments = [];
    for (const p of paragraphs) {
      const s = p.speaker ?? 0, t = p.sentences.map(s => s.text).join(" ");
      text += `[Speaker ${s}]: ${t}\n`;
      segments.push({ speaker: s, text: t, start: p.start, end: p.end });
    }
    if (!text) { const alt = result.results.channels[0]?.alternatives[0]?.transcript || ""; text = alt; segments.push({ speaker: 0, text: alt, start: 0, end: 0 }); }
    res.json({ transcription: text.trim(), segments });
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
    const { transcription, template, templates } = req.body;
    if (!transcription) return res.status(400).json({ error: "Falta transcripción" });

    let templatePrompt;
    if (templates && templates.length > 0) {
      const list = templates.map(t => `- ${t.name}: ${(t.columns||[]).join(", ")}`).join("\n");
      templatePrompt = `Eres un asistente técnico de INGELUBSA S.A.S. Extrae datos según las plantillas disponibles del proyecto.

Plantillas disponibles:
${list}

El audio puede mencionar qué plantilla usar. Detectala y extrae datos en ese formato. Devuelve SOLO JSON:
{
  "plantilla": "nombre de la plantilla usada",
  "activo": "Nombre del equipo",
  "componentes": [{ "nombre": "", "cantidad": "", "lubricante": "", "frecuencia": "", "ubicacion": "", "observaciones": "" }],
  "faltantes": ["datos críticos que faltan"],
  "preguntas": ["preguntas para completar"]
}
Si no se detecta plantilla, usá columnas genéricas. IMPORTANTE: solo JSON.`;
    } else {
      templatePrompt = getTemplatePrompt(template || "ruta_lubricacion");
    }

    const msg = await getClaude().messages.create({
      model: "claude-3-5-sonnet-latest",
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

// ── Editor Excel ──────────────────────────────────────
app.get("/api/projects/:id/files/:fileId/preview", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data: file } = await sb.from("files").select("*").eq("id", req.params.fileId).single();
    if (!file) return res.status(404).json({ error: "No encontrado" });
    const storagePath = `${file.project_id}/${file.id}`;
    const { data: dl } = await sb.storage.from("lubia-files").download(storagePath);
    if (!dl) return res.status(404).json({ error: "Archivo no encontrado" });
    const buf = Buffer.from(await dl.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer", cellStyles: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const headers = (rows[0] || []).map(h => String(h || ""));
    const data = rows.slice(1).map((row, i) => {
      const obj = {};
      headers.forEach((h, j) => { obj[`col${j}`] = String(row[j] || ""); });
      return obj;
    });
    // Extraer estilos: colores, bordes
    const styles = {};
    for (const cellRef in sheet) {
      if (cellRef.startsWith("!")) continue;
      const cell = sheet[cellRef];
      const addr = XLSX.utils.decode_cell(cellRef);
      if (addr.r === 0) continue; // skip header
      const ri = addr.r - 1, ci = addr.c;
      const s = {};
      if (cell.s) {
        if (cell.s.fgColor && cell.s.fgColor.rgb) s.bg = "#" + cell.s.fgColor.rgb.slice(2);
        if (cell.s.font && cell.s.font.color && cell.s.font.color.rgb) s.color = "#" + cell.s.font.color.rgb.slice(2);
        if (cell.s.font && cell.s.font.bold) s.bold = true;
        if (cell.s.font && cell.s.font.italic) s.italic = true;
      }
      if (Object.keys(s).length > 0) styles[`${ri}_${ci}`] = s;
    }
    // Obtener merges
    const merges = sheet["!merges"] || [];
    styles["_merges"] = merges.map(m => ({ r1: m.s.r - 1, c1: m.s.c, r2: m.e.r - 1, c2: m.e.c }));

    res.json({ headers, rows: data, filename: file.name, cellStyles: styles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/projects/:id/files/:fileId/edit", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data: file } = await sb.from("files").select("*").eq("id", req.params.fileId).single();
    if (!file) return res.status(404).json({ error: "No encontrado" });

    const { headers, rows: dataRows, cellStyles } = req.body;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Hoja1");

    // Headers con estilo INGELUBSA
    const headerRow = sheet.getRow(1);
    headers.forEach((h, j) => {
      const cell = headerRow.getCell(j + 1);
      cell.value = h;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAB308" } };
      cell.font = { bold: true, color: { argb: "FF111827" }, size: 12 };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });

    // Filas de datos con estilos
    for (let i = 0; i < dataRows.length; i++) {
      const row = sheet.getRow(i + 2);
      for (let j = 0; j < headers.length; j++) {
        const cell = row.getCell(j + 1);
        cell.value = (dataRows[i][`col${j}`] || "").replace(/\[img:.*?\]/, "").trim();
        const style = (cellStyles || {})[`${i}_${j}`] || {};
        if (style.bg && style.bg !== "#ffffff") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + style.bg.replace("#", "") } };
        if (style.color && style.color !== "#000000") cell.font = { ...cell.font, color: { argb: "FF" + style.color.replace("#", "") } };
        if (style.bold) cell.font = { ...cell.font, bold: true };
        if (style.italic) cell.font = { ...cell.font, italic: true };
        const bd = style.border === "thick" ? "medium" : style.border === "thin" ? "thin" : style.border === "double" ? "double" : undefined;
        if (bd) cell.border = { top: { style: bd }, bottom: { style: bd }, left: { style: bd }, right: { style: bd } };
        else cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.font = { ...cell.font, size: 12 };
      }
    }

    // Merged cells
    const merges = (cellStyles || {})["_merges"] || [];
    for (const m of merges) sheet.mergeCells(Number(m.r1) + 2, Number(m.c1) + 1, Number(m.r2) + 2, Number(m.c2) + 1);

    // Embed imágenes
    for (let i = 0; i < dataRows.length; i++) {
      for (let j = 0; j < headers.length; j++) {
        const val = dataRows[i][`col${j}`] || "";
        const match = val.match(/\[img:\s*(.+?)\]/);
        if (match) {
          try {
            const { data: imgFiles } = await sb.from("files").select("*").eq("project_id", file.project_id).ilike("name", `%${match[1].trim()}%`).ilike("mimetype", "image/%");
            if (imgFiles && imgFiles.length > 0) {
              const imgFile = imgFiles[0];
              const { data: imgData } = await sb.storage.from("lubia-files").download(`${imgFile.project_id}/${imgFile.id}`);
              if (imgData) {
                const imgId = workbook.addImage({ buffer: Buffer.from(await imgData.arrayBuffer()), extension: imgFile.mimetype.split("/")[1] || "jpeg" });
                sheet.addImage(imgId, { tl: { col: j, row: i + 1 }, br: { col: j + 1, row: i + 2 }, editAs: "oneCell" });
                sheet.getRow(i + 2).height = 90;
              }
            }
          } catch {}
        }
      }
    }

    // Column widths
    headers.forEach((_, j) => { sheet.getColumn(j + 1).width = Math.max(15, (headers[j] || "").length * 2 + 5); });

    const outBuf = await workbook.xlsx.writeBuffer();
    const storagePath = `${file.project_id}/${file.id}`;
    await sb.storage.from("lubia-files").upload(storagePath, outBuf, { contentType: file.mimetype, upsert: true, cacheControl: "0" });
    await sb.from("files").update({ size: outBuf.length }).eq("id", req.params.fileId);
    res.json({ ok: true, size: outBuf.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects/:id/files/:fileId/ai-edit", async (req, res) => {
  try {
    const { command, headers, rows } = req.body;
    if (!command) return res.status(400).json({ error: "Falta el comando" });

    const tableText = [headers.join(" | "), ...rows.map((r, i) => headers.map((_, j) => `[${i},${j}] ${r[`col${j}`] || ""}`).join(" | "))].join("\n");

    const msg = await getClaude().messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      system: `Eres un editor de planillas Excel. El usuario te dará un comando y una tabla. Debes modificar la tabla según el comando. Devuelve SOLO un JSON con: { "headers": ["col1","col2"...], "rows": [{"col0":"val","col1":"val"...}] }. Respeta el formato original de columnas. IMPORTANTE: solo el JSON, sin texto.`,
      messages: [{ role: "user", content: `Comando: ${command}\n\nTabla actual:\n${tableText}` }],
    });

    const content = msg.content[0]?.text || "{}";
    const jsonText = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const brace = jsonText.indexOf("{"), lastBrace = jsonText.lastIndexOf("}");
    const clean = jsonText.slice(brace >= 0 ? brace : 0, lastBrace >= 0 ? lastBrace + 1 : undefined);
    let result;
    try { result = JSON.parse(clean); } catch { return res.status(500).json({ error: "Claude no devolvió JSON válido", raw: content }); }

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Chat del proyecto ─────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { message, projectId, context } = req.body;
    if (!message) return res.status(400).json({ error: "Mensaje vacío" });
    if (!process.env.CLAUDE_API_KEY) return res.status(500).json({ error: "CLAUDE_API_KEY no configurada en el servidor" });

    const claude = getClaude();
    const systemCtx = context || "";
    const msg = await claude.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      system: `Eres LUBIA, el asistente IA de INGELUBSA S.A.S., especialista en lubricación industrial, monitoreo y confiabilidad. Respondé en español, de forma clara y técnica. Contexto del proyecto: ${systemCtx}`,
      messages: [{ role: "user", content: message }],
    });
    res.json({ reply: msg.content[0]?.text || "Sin respuesta" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Plantillas ────────────────────────────────────────
app.get("/api/projects/:id/templates", async (req, res) => {
  try {
    const { data } = await getSupabaseAdmin().from("templates").select("*").eq("project_id", req.params.id).order("created_at");
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects/:id/templates", async (req, res) => {
  const { name, description, columns } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data } = await getSupabaseAdmin().from("templates").insert({
      project_id: req.params.id, name, description: description || "", columns: columns || [],
    }).select().single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/projects/:id/templates/:tid", async (req, res) => {
  const { name, description, columns } = req.body;
  try {
    await getSupabaseAdmin().from("templates").update({ name, description, columns }).eq("id", req.params.tid).eq("project_id", req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/projects/:id/templates/:tid", async (req, res) => {
  try {
    await getSupabaseAdmin().from("templates").delete().eq("id", req.params.tid).eq("project_id", req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects/:id/templates/import", async (req, res) => {
  try {
    const { sourceProjectId, sourceTemplateId } = req.body;
    const { data: source } = await getSupabaseAdmin().from("templates").select("*").eq("id", sourceTemplateId).single();
    if (!source) return res.status(404).json({ error: "Plantilla origen no encontrada" });
    const { data } = await getSupabaseAdmin().from("templates").insert({
      project_id: req.params.id, name: source.name + " (importada)", description: source.description, columns: source.columns,
    }).select().single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects/:id/templates/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió archivo" });
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const headers = (rows[0] || []).map(h => String(h || "").trim()).filter(h => h);
    res.json({ name: req.file.originalname.replace(/\.[^.]+$/, ""), columns: headers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Iniciar ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`LUBIA corriendo en http://localhost:${PORT}`);
  console.log(`Datos en: ${DATA_DIR}`);
});
