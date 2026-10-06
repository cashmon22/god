// @vitest-environment jsdom
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRefreshFetch, clearRefreshRateLimit } from "./auth-refresh-fetch";

const storageKey = "auth-sdk-refresh-test";
const savedValues = new Map<string, string>();
const storage = {
  getItem: (key: string) => savedValues.get(key) ?? null,
  setItem: (key: string, value: string) => { savedValues.set(key, value); },
  removeItem: (key: string) => { savedValues.delete(key); },
};
const user = {
  id: "user-1",
  aud: "authenticated",
  role: "authenticated",
  email: "user@example.com",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date(0).toISOString(),
};

function session(expiresAt: number) {
  return {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    expires_at: expiresAt,
    expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
    token_type: "bearer",
    user,
  };
}

function makeClient() {
  savedValues.set(storageKey, JSON.stringify(session(Math.floor(Date.now() / 1000) + 3600)));
  return createClient("https://example.supabase.co", "test-publishable-key", {
    global: { fetch: authRefreshFetch },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
      storage,
      storageKey,
    },
  });
}

describe("Supabase auth-js refresh coordination", () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    clearRefreshRateLimit();
    savedValues.clear();
    client = makeClient();
  });

  afterEach(async () => {
    await client.auth.dispose();
    clearRefreshRateLimit();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("coalesces simultaneous near-expiry session reads into one refresh request", async () => {
    await client.auth.getSession();
    savedValues.set(storageKey, JSON.stringify(session(Math.floor(Date.now() / 1000) + 10)));
    const networkFetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
      token_type: "bearer",
      user,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", networkFetch);

    const results = await Promise.all(Array.from({ length: 5 }, () => client.auth.getSession()));

    expect(results.every(({ data }) => data.session?.access_token === "new-access-token")).toBe(true);
    expect(networkFetch).toHaveBeenCalledOnce();
  });

});
