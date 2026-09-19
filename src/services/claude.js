import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "../config/env.js";

let _claude = null;

export function getClaude() {
  if (!_claude) {
    _claude = new Anthropic({ apiKey: getSetting("CLAUDE_API_KEY") });
  }
  return _claude;
}

export function resetClaude() {
  _claude = null;
}

export function getTemplatePrompt(type) {
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

export async function extraerDatosDeTranscripcion(transcription, templates, templateName) {
  let templatePrompt;
  if (templates && templates.length > 0) {
    const list = templates.map((t) => `- ${t.name}: ${(t.columns || []).join(", ")}`).join("\n");
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
    templatePrompt = getTemplatePrompt(templateName || "ruta_lubricacion");
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
  try {
    data = JSON.parse(clean);
  } catch {
    data = { error: "No se pudo parsear", raw: content };
  }
  return data;
}

export async function responderChat({ message, context }) {
  const claude = getClaude();
  const systemCtx = context || "";
  const msg = await claude.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 2000,
    system: `Eres LUBIA, el asistente IA de INGELUBSA S.A.S., especialista en lubricación industrial, monitoreo y confiabilidad. Respondé en español, de forma clara y técnica. Contexto del proyecto: ${systemCtx}`,
    messages: [{ role: "user", content: message }],
  });
  return msg.content[0]?.text || "Sin respuesta";
}

export async function aiEditExcelTable({ command, headers, rows }) {
  const tableText = [
    headers.join(" | "),
    ...rows.map((r, i) => headers.map((_, j) => `[${i},${j}] ${r[`col${j}`] || ""}`).join(" | ")),
  ].join("\n");

  const msg = await getClaude().messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 4000,
    system: `Eres un editor de planillas Excel. El usuario te dará un comando y una tabla. Debes modificar la tabla según el comando. Devuelve SOLO un JSON con: { "headers": ["col1","col2"...], "rows": [{"col0":"val","col1":"val"...}] }. Respeta el formato original de columnas. IMPORTANTE: solo el JSON, sin texto.`,
    messages: [{ role: "user", content: `Comando: ${command}\n\nTabla actual:\n${tableText}` }],
  });

  const content = msg.content[0]?.text || "{}";
  const jsonText = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const brace = jsonText.indexOf("{");
  const lastBrace = jsonText.lastIndexOf("}");
  const clean = jsonText.slice(brace >= 0 ? brace : 0, lastBrace >= 0 ? lastBrace + 1 : undefined);

  try {
    return JSON.parse(clean);
  } catch {
    throw new Error("Claude no devolvió JSON válido");
  }
}
