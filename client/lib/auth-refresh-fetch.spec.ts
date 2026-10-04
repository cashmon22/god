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
  });
});
