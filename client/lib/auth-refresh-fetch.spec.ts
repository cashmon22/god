 ai_main_10604776168c4613afcc
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRefreshFetch, clearRefreshRateLimit } from "./auth-refresh-fetch";

const refreshUrl = "https://example.supabase.co/auth/v1/token?grant_type=refresh_token";

beforeEach(() => {
  clearRefreshRateLimit();
  vi.stubGlobal("window", { location: { origin: "https://example.com" } });
});

afterEach(() => {
  clearRefreshRateLimit();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authRefreshFetch", () => {
  it("shares one in-flight refresh request", async () => {
    let resolveResponse!: (response: Response) => void;
    const networkFetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    vi.stubGlobal("fetch", networkFetch);

    const first = authRefreshFetch(refreshUrl, { method: "POST" });
    const second = authRefreshFetch(refreshUrl, { method: "POST" });
    resolveResponse(new Response("{}", { status: 200 }));

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
  });

  it("caches 429 responses until Retry-After has elapsed", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const networkFetch = vi.fn()
      .mockResolvedValueOnce(new Response("{\"error\":\"over_request_rate_limit\"}", {
        status: 429,
        headers: { "Retry-After": "120" },
      }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", networkFetch);

    expect((await authRefreshFetch(refreshUrl, { method: "POST" })).status).toBe(429);
    expect((await authRefreshFetch(refreshUrl, { method: "POST" })).status).toBe(429);
    expect(networkFetch).toHaveBeenCalledOnce();

    now.mockReturnValue(1_120_001);
    expect((await authRefreshFetch(refreshUrl, { method: "POST" })).status).toBe(200);
    expect(networkFetch).toHaveBeenCalledTimes(2);

import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRefreshFetch } from "./auth-refresh-fetch";

describe("createAuthRefreshFetch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers retry-token requests after a rate limit without sending another request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const authFetch = createAuthRefreshFetch(fetcher);
    const url = "https://example.supabase.co/auth/v1/token?grant_type=refresh_token";

    const limited = await authFetch(url, { method: "POST" });
    const deferred = await authFetch(url, { method: "POST" });

    expect(limited.status).toBe(503);
    expect(deferred.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    const recovered = await authFetch(url, { method: "POST" });

    expect(recovered.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not transform rate limits from other Auth endpoints", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 429 }));
    const authFetch = createAuthRefreshFetch(fetcher);

    const response = await authFetch("https://example.supabase.co/auth/v1/user", { method: "GET" });

    expect(response.status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
 main
  });
});
