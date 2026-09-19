import { Router } from "express";
import multer from "multer";
import { getSupabaseAdmin } from "../services/supabase.js";

const router = Router();
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── Archivos y carpetas del proyecto ──────────────────
router.get("/projects/:id/files", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const sedeId = req.query.sede_id || null;
    const filterType = req.query.type || null;

    let qF = sb.from("folders").select("*").eq("project_id", req.params.id);
    let qFi = sb.from("files").select("*").eq("project_id", req.params.id);

    if (sedeId) {
      qF = qF.eq("sede_id", sedeId);
      qFi = qFi.eq("sede_id", sedeId);
    }
    if (filterType === "image") {
      qFi = qFi.ilike("mimetype", "image/%");
    }

    const [{ data: folders, error: errFolders }, { data: files, error: errFiles }] = await Promise.all([qF, qFi]);
    if (errFolders) throw errFolders;
    if (errFiles) throw errFiles;

    res.json({ folders: folders || [], files: files || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/projects/:id/folders", async (req, res) => {
  const { name, parentId, sedeId } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("folders")
      .insert({
        project_id: req.params.id,
        name,
        parent_id: parentId || null,
        sede_id: sedeId || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/projects/:id/folders/:folderId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    await sb.from("files").delete().eq("folder_id", req.params.folderId);
    await sb.from("folders").delete().eq("id", req.params.folderId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/projects/:id/files", fileUpload.array("files", 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No se recibieron archivos" });
  }
  try {
    const sb = getSupabaseAdmin();
    const results = [];
    for (const file of req.files) {
      const { data, error: insertErr } = await sb
        .from("files")
        .insert({
          project_id: req.params.id,
          folder_id: req.body.folderId || null,
          sede_id: req.body.sedeId || null,
          name: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      const storagePath = `${req.params.id}/${data.id}`;
      const { error: uploadErr } = await sb.storage
        .from("lubia-files")
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
          cacheControl: "0",
        });

      if (uploadErr) {
        await sb.from("files").delete().eq("id", data.id);
        console.error("[Upload] Error Storage:", uploadErr);
      } else {
        results.push(data);
        console.log(`[Upload] OK: ${file.originalname} (${file.size} bytes)`);
      }
    }
    res.json({ count: results.length, files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/projects/:id/files/:fileId", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    await sb.from("files").delete().eq("id", req.params.fileId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/projects/:id/files/:fileId", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("files")
      .update({ name })
      .eq("id", req.params.fileId)
      .eq("project_id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data || { ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/projects/:id/files/:fileId/move", async (req, res) => {
  try {
    const { error } = await getSupabaseAdmin()
      .from("files")
      .update({ folder_id: req.body.folderId || null })
      .eq("id", req.params.fileId)
      .eq("project_id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Visualizar archivo ────────────────────────────────
router.get("/projects/:id/files/:fileId/view", async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data: file, error } = await sb
      .from("files")
      .select("*")
      .eq("id", req.params.fileId)
      .single();

    if (error || !file) return res.status(404).json({ error: "Archivo no encontrado en BD" });

    const storagePath = `${file.project_id}/${file.id}`;
    const { data: urlData } = sb.storage.from("lubia-files").getPublicUrl(storagePath);
    if (urlData?.publicUrl) return res.redirect(urlData.publicUrl);

    const { data: signed } = await sb.storage.from("lubia-files").createSignedUrl(storagePath, 3600);
    if (signed?.signedUrl) return res.redirect(signed.signedUrl);

    res.status(404).json({ error: `Archivo no encontrado en Storage: ${storagePath}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
