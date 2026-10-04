import { createClient } from "@supabase/supabase-js";
import { createAuthRefreshFetch } from "./auth-refresh-fetch";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const authStorage = typeof window === "undefined" ? undefined : window.sessionStorage;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  global: { fetch: createAuthRefreshFetch() },
  auth: {
    persistSession: true,
    storage: authStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
