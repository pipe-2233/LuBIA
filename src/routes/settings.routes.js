import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import { getSetting } from "../config/env.js";
import { resetDeepgram } from "../services/deepgram.js";
import { resetClaude } from "../services/claude.js";

const router = Router();

// ── Obtener configuración ──────────────────────────────
router.get("/settings", async (_req, res) => {
  try {
    const { data } = await getSupabaseAdmin().from("settings").select("*");
    const obj = {};
    for (const r of data || []) {
      obj[r.key] = r.value;
    }
    obj.SUPABASE_URL = obj.SUPABASE_URL || getSetting("SUPABASE_URL") || "";
    res.json(obj);
  } catch {
    res.json({});
  }
});

// ── Guardar configuración ──────────────────────────────
router.post("/settings", async (req, res) => {
  try {
    const saveableKeys = ["RUTA_CORREOS"];
    for (const key of saveableKeys) {
      if (req.body[key] !== undefined) {
        await getSupabaseAdmin().from("settings").upsert({ key, value: req.body[key] });
      }
    }
    resetDeepgram();
    resetClaude();
    res.json({ ok: true });
  } catch (err) {
    console.error("[Settings Post]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
