import "dotenv/config";
import express from "express";
import multer from "multer";
import { createClient } from "@deepgram/sdk";
import Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const DATA_DIR = join(__dirname, "data");
const PROJ_FILE = join(DATA_DIR, "projects.json");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");
const EXPORT_DIR = join(__dirname, "exports");
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(EXPORT_DIR, { recursive: true });

// ── Helpers: archivo como BD ──────────────────────────
function loadJSON(path, fallback) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : fallback; } catch { return fallback; }
}
function saveJSON(path, data) { writeFileSync(path, JSON.stringify(data, null, 2), "utf-8"); }

function getSettings() {
  return loadJSON(SETTINGS_FILE, {});
}

function getSetting(key) {
  const s = getSettings();
  return s[key] || process.env[key] || "";
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

// ── Proyectos (persistencia en archivo) ────────────────
app.get("/api/projects", (_req, res) => res.json(loadJSON(PROJ_FILE, [])));

app.post("/api/projects", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  const projects = loadJSON(PROJ_FILE, []);
  const p = { id: randomUUID(), name, createdAt: new Date().toISOString() };
  projects.push(p);
  saveJSON(PROJ_FILE, projects);
  res.json(p);
});

// ── Settings ───────────────────────────────────────────
app.get("/api/settings", (_req, res) => {
  res.json(getSettings());
});

app.post("/api/settings", (req, res) => {
  const allowed = ["DEEPGRAM_API_KEY", "CLAUDE_API_KEY", "GMAIL_USER", "GMAIL_PASS", "EMAIL_TO", "OLLAMA_MODEL"];
  const current = getSettings();
  for (const key of allowed) {
    if (req.body[key] !== undefined) current[key] = req.body[key];
  }
  saveJSON(SETTINGS_FILE, current);
  _deepgram = null;
  _claude = null;
  res.json({ ok: true });
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

// ── Iniciar ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`LUBIA corriendo en http://localhost:${PORT}`);
  console.log(`Datos en: ${DATA_DIR}`);
});
