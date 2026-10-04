const MIN_REFRESH_RETRY_DELAY_MS = 60_000;

function refreshRetryDelay(response: Response, now: number) {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(MIN_REFRESH_RETRY_DELAY_MS, seconds * 1000);

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(MIN_REFRESH_RETRY_DELAY_MS, retryAt - now);
  }
  return MIN_REFRESH_RETRY_DELAY_MS;
}

function retryableResponse() {
  return new Response(JSON.stringify({ message: "Supabase Auth refresh is rate limited." }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

export function createAuthRefreshFetch(fetcher: typeof fetch = fetch): typeof fetch {
  let refreshBlockedUntil = 0;
  let refreshWindowStartedAt = Date.now();
  let refreshRequestsInWindow = 0;

  return async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = new URL(requestUrl);
    const isRefreshRequest = method === "POST"
      && url.pathname.endsWith("/auth/v1/token")
      && url.searchParams.get("grant_type") === "refresh_token";

    if (!isRefreshRequest) return fetcher(input, init);
    const now = Date.now();
    if (now < refreshBlockedUntil) return retryableResponse();
    if (now - refreshWindowStartedAt >= 5 * 60_000) {
      refreshWindowStartedAt = now;
      refreshRequestsInWindow = 0;
    }
    if (refreshWindowStartedAt === 0) refreshWindowStartedAt = now;
    refreshRequestsInWindow += 1;

    const response = await fetcher(input, init);
    if (response.status !== 429) {
      refreshBlockedUntil = 0;
      return response;
    }

    const retryDelay = refreshRetryDelay(response, Date.now());
    refreshBlockedUntil = Date.now() + retryDelay;
    console.warn("[auth] Refresh request rate limited; retry deferred.", {
      retryDelaySeconds: Math.ceil(retryDelay / 1000),
      refreshRequestsInLastFiveMinutes: refreshRequestsInWindow,
    });
    return retryableResponse();
  };
}
