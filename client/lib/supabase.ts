import { createClient, type Session } from "@supabase/supabase-js";
import { authRefreshFetch, clearRefreshRateLimit, isRefreshRateLimited } from "./auth-refresh-fetch";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const tabStorageKeyName = "app.supabase.auth.storage-key";
const tabStorageKey = window.sessionStorage.getItem(tabStorageKeyName) ?? `app.supabase.auth.${crypto.randomUUID()}`;
window.sessionStorage.setItem(tabStorageKeyName, tabStorageKey);
const persistedAuthPrefix = "app.supabase.auth.session";

function sessionStorageKey(key: string) {
  return `${persistedAuthPrefix}${key.slice(tabStorageKey.length)}`;
}

let explicitSignOut = false;
const authStorage = {
  getItem: (key: string) => window.sessionStorage.getItem(sessionStorageKey(key)),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(sessionStorageKey(key), value),
  removeItem: (key: string) => {
    if (key !== tabStorageKey || explicitSignOut || !isRefreshRateLimited()) {
      window.sessionStorage.removeItem(sessionStorageKey(key));
    }
  },
};

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  global: { fetch: authRefreshFetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: authStorage,
    storageKey: tabStorageKey,
  },
});

type SessionResponse = Awaited<ReturnType<typeof supabase.auth.getSession>>;
let sessionRead: Promise<SessionResponse> | null = null;

function storedSessionDuringRateLimit(): Session | null {
  if (!isRefreshRateLimited()) return null;
  const stored = authStorage.getItem(tabStorageKey);
  if (!stored) return null;
  try {
    const session = JSON.parse(stored) as Partial<Session>;
    return typeof session.access_token === "string" &&
      typeof session.refresh_token === "string" &&
      typeof session.expires_at === "number" &&
      typeof session.user?.id === "string"
      ? session as Session
      : null;
  } catch {
    return null;
  }
}

export function getCurrentSession() {
  if (sessionRead) return sessionRead;

  const pending = supabase.auth.getSession().then((result) => {
    if (!result.data.session && result.error) {
      const session = storedSessionDuringRateLimit();
      if (session) return { data: { session }, error: null };
    }
    return result;
  });
  sessionRead = pending;
  const clearPending = () => {
    if (sessionRead === pending) sessionRead = null;
  };
  void pending.then(clearPending, clearPending);
  return pending;
}

export function getSessionDuringRateLimit() {
  return storedSessionDuringRateLimit();
}

export async function signOutCurrentSession() {
  explicitSignOut = true;
  clearRefreshRateLimit();
  try {
    return await supabase.auth.signOut();
  } finally {
    explicitSignOut = false;
  }
}
