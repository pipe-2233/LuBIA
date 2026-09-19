import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import {
  generarExcelRuta,
  parseExcelBufferForPreview,
  saveEditedExcelWorkbook,
} from "../services/excel.js";
import { aiEditExcelTable } from "../services/claude.js";

const router = Router();

// ── Generar Excel de Ruta de Lubricación ────────────────
router.post("/generar-excel", async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: "Faltan datos" });

    const { filepath, filename } = await generarExcelRuta(data);
    console.log(`[Excel] Generado: ${filename}`);
    res.download(filepath, filename);
  } catch (err) {
    console.error("[Excel]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Editor Excel: Preview ──────────────────────────────
router.get("/projects/:id/files/:fileId/preview", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data: file, error } = await sb
      .from("files")
      .select("*")
      .eq("id", req.params.fileId)
      .single();

    if (error || !file) return res.status(404).json({ error: "No encontrado" });

    const storagePath = `${file.project_id}/${file.id}`;
    const { data: dl, error: dlErr } = await sb.storage.from("lubia-files").download(storagePath);
    if (dlErr || !dl) return res.status(404).json({ error: "Archivo no encontrado" });

    const buf = Buffer.from(await dl.arrayBuffer());
    const preview = parseExcelBufferForPreview(buf, file.name);
    res.json(preview);
  } catch (err) {
    console.error("[Excel Preview]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Editor Excel: Guardar cambios ─────────────────────
router.put("/projects/:id/files/:fileId/edit", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data: file, error } = await sb
      .from("files")
      .select("*")
      .eq("id", req.params.fileId)
      .single();

    if (error || !file) return res.status(404).json({ error: "No encontrado" });

    const { headers, rows, cellStyles } = req.body;
    const outBuf = await saveEditedExcelWorkbook({
      projectId: file.project_id,
      headers,
      rows,
      cellStyles,
    });

    const storagePath = `${file.project_id}/${file.id}`;
    const { error: uploadErr } = await sb.storage
      .from("lubia-files")
      .upload(storagePath, outBuf, {
        contentType: file.mimetype,
        upsert: true,
        cacheControl: "0",
      });

    if (uploadErr) throw uploadErr;

    await sb.from("files").update({ size: outBuf.length }).eq("id", req.params.fileId);
    res.json({ ok: true, size: outBuf.length });
  } catch (err) {
    console.error("[Excel Edit]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Editor Excel: Comando IA ──────────────────────────
router.post("/projects/:id/files/:fileId/ai-edit", async (req, res) => {
  try {
    const { command, headers, rows } = req.body;
    if (!command) return res.status(400).json({ error: "Falta el comando" });

    const result = await aiEditExcelTable({ command, headers, rows });
    res.json(result);
  } catch (err) {
    console.error("[AI-Edit]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
