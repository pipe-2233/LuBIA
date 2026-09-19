import { Router } from "express";
import multer from "multer";
import { getSupabaseAdmin } from "../services/supabase.js";
import { extractHeadersFromExcel } from "../services/excel.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ── Listar plantillas de un proyecto ───────────────────
router.get("/projects/:id/templates", async (req, res) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("templates")
      .select("*")
      .eq("project_id", req.params.id)
      .order("created_at");
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Crear plantilla ────────────────────────────────────
router.post("/projects/:id/templates", async (req, res) => {
  const { name, description, columns } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("templates")
      .insert({
        project_id: req.params.id,
        name,
        description: description || "",
        columns: columns || [],
      })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Actualizar plantilla ───────────────────────────────
router.put("/projects/:id/templates/:tid", async (req, res) => {
  const { name, description, columns } = req.body;
  try {
    const { error } = await getSupabaseAdmin()
      .from("templates")
      .update({ name, description, columns })
      .eq("id", req.params.tid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Eliminar plantilla ─────────────────────────────────
router.delete("/projects/:id/templates/:tid", async (req, res) => {
  try {
    const { error } = await getSupabaseAdmin()
      .from("templates")
      .delete()
      .eq("id", req.params.tid)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Importar plantilla desde otro proyecto ─────────────
router.post("/projects/:id/templates/import", async (req, res) => {
  try {
    const { sourceTemplateId } = req.body;
    const sb = getSupabaseAdmin();
    const { data: source, error: srcErr } = await sb
      .from("templates")
      .select("*")
      .eq("id", sourceTemplateId)
      .single();

    if (srcErr || !source) return res.status(404).json({ error: "Plantilla origen no encontrada" });

    const { data, error } = await sb
      .from("templates")
      .insert({
        project_id: req.params.id,
        name: source.name + " (importada)",
        description: source.description,
        columns: source.columns,
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Extraer columnas desde un Excel ────────────────────
router.post("/projects/:id/templates/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió archivo" });
  try {
    const extracted = extractHeadersFromExcel(req.file.buffer, req.file.originalname);
    res.json(extracted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
