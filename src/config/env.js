import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const ROOT_DIR = join(__dirname, "../..");
export const EXPORT_DIR = join(ROOT_DIR, "exports");
export const DATA_DIR = join(ROOT_DIR, "data");

config({ path: join(ROOT_DIR, ".env") });

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(EXPORT_DIR, { recursive: true });

export function getSetting(key) {
  const envKeys = [
    "DEEPGRAM_API_KEY",
    "CLAUDE_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_KEY",
    "GMAIL_USER",
    "GMAIL_PASS",
    "EMAIL_TO",
    "OLLAMA_MODEL",
    "PORT"
  ];
  if (envKeys.includes(key)) return process.env[key] || "";
  return process.env[key] || "";
}
