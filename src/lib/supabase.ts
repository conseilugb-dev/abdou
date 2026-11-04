import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.warn("Variables Supabase absentes. Configure ton fichier .env.");
}

export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  key || "placeholder"
);