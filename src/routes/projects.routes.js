import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";

const router = Router();

// ── Proyectos ──────────────────────────────────────────
router.get("/projects", async (_req, res) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/projects", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("projects")
      .insert({ name })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sedes del proyecto ─────────────────────────────────
router.get("/projects/:id/sedes", async (req, res) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("sedes")
      .select("*")
      .eq("project_id", req.params.id)
      .order("created_at");
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/projects/:id/sedes", async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("sedes")
      .insert({
        project_id: req.params.id,
        name,
        description: description || "",
      })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/projects/:id/sedes/:sedeId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    await sb.from("files").delete().eq("sede_id", req.params.sedeId);
    await sb.from("folders").delete().eq("sede_id", req.params.sedeId);
    await sb.from("sedes").delete().eq("id", req.params.sedeId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
