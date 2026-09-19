import { Router } from "express";
import multer from "multer";
import { getSupabaseAdmin } from "../services/supabase.js";
import { transcribeAudioBuffer } from "../services/deepgram.js";
import { extraerDatosDeTranscripcion, responderChat } from "../services/claude.js";
import { getSetting } from "../config/env.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ── Transcribir archivo de audio del proyecto ─────────
router.post("/transcribe-file/:fileId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data: file, error } = await sb
      .from("files")
      .select("*")
      .eq("id", req.params.fileId)
      .single();

    if (error || !file) return res.status(404).json({ error: "Archivo no encontrado" });

    const storagePath = `${file.project_id}/${file.id}`;
    const { data: dl, error: dlErr } = await sb.storage.from("lubia-files").download(storagePath);
    if (dlErr || !dl) return res.status(404).json({ error: "Archivo no encontrado en Storage" });

    const buf = Buffer.from(await dl.arrayBuffer());
    const result = await transcribeAudioBuffer(buf);
    res.json(result);
  } catch (err) {
    console.error("[Transcribe-File]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Transcribir audio subido directamente ───────────────
router.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No se recibió audio" });
    const result = await transcribeAudioBuffer(req.file.buffer);
    console.log(`[Deepgram] ${result.segments.length} segmentos, ${result.transcription.length} chars`);
    res.json(result);
  } catch (err) {
    console.error("[Transcribe]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Claude: Extraer datos estructurados ──────────────────
router.post("/extraer", async (req, res) => {
  try {
    const { transcription, template, templates } = req.body;
    if (!transcription) return res.status(400).json({ error: "Falta transcripción" });

    const data = await extraerDatosDeTranscripcion(transcription, templates, template);
    console.log("[Claude] Extracción OK");
    res.json(data);
  } catch (err) {
    console.error("[Extraer]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Chat del proyecto ─────────────────────────────────
router.post("/chat", async (req, res) => {
  try {
    const { message, projectId, context } = req.body;
    if (!message) return res.status(400).json({ error: "Mensaje vacío" });
    if (!getSetting("CLAUDE_API_KEY")) {
      return res.status(500).json({ error: "CLAUDE_API_KEY no configurada en el servidor" });
    }

    const reply = await responderChat({ message, context, projectId });
    res.json({ reply });
  } catch (err) {
    console.error("[Chat]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
