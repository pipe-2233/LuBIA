import { createClient as createSupabase } from "@supabase/supabase-js";
import { getSetting } from "../config/env.js";

let _supabase = null;

export function getSupabaseAdmin() {
  if (!_supabase) {
    const url = getSetting("SUPABASE_URL");
    const key = getSetting("SUPABASE_SERVICE_KEY") || getSetting("SUPABASE_ANON_KEY");
    if (!url || !key) {
      console.warn("[Supabase] SUPABASE_URL o KEY no configurados.");
    }
    _supabase = createSupabase(url, key);
  }
  return _supabase;
}
