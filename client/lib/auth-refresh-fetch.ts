 ai_main_10604776168c4613afcc
const DEFAULT_RATE_LIMIT_DELAY_MS = 60_000;
const RATE_LIMIT_STORAGE_KEY = "app.supabase.auth.refresh-rate-limit-until";

let refreshInFlight: Promise<Response> | null = null;
let rateLimitedResponse: Response | null = null;
let rateLimitedUntil = readRateLimitUntil();

function readRateLimitUntil() {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.sessionStorage.getItem(RATE_LIMIT_STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function isRefreshRequest(input: RequestInfo | URL, init?: RequestInit) {
  const url = input instanceof Request ? input.url : input.toString();
  const requestUrl = new URL(url, window.location.origin);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase() === "POST" &&
    requestUrl.pathname.endsWith("/auth/v1/token") &&
    requestUrl.searchParams.get("grant_type") === "refresh_token";
}

function retryDelayMs(value: string | null) {
  if (!value) return DEFAULT_RATE_LIMIT_DELAY_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt)
    ? Math.max(0, retryAt - Date.now())
    : DEFAULT_RATE_LIMIT_DELAY_MS;
}

function rateLimitResponse() {
  const retryAfter = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
  return new Response(JSON.stringify({
    code: "over_request_rate_limit",
    message: "Auth refresh is temporarily rate limited.",
  }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
  });
}

function logRefresh(event: "started" | "already in progress" | "completed" | "rate limited") {
  if (import.meta.env.DEV) console.info(`[auth] refresh ${event}`);
}

export function isRefreshRateLimited() {
  return Date.now() < rateLimitedUntil;
}

export function clearRefreshRateLimit() {
  rateLimitedResponse = null;
  rateLimitedUntil = 0;
  try {
    window.sessionStorage.removeItem(RATE_LIMIT_STORAGE_KEY);
  } catch {
    // Session storage is optional outside standard browser contexts.
  }
}

export const authRefreshFetch: typeof fetch = async (input, init) => {
  if (!isRefreshRequest(input, init)) return fetch(input, init);

  if (isRefreshRateLimited()) {
    logRefresh("rate limited");
    return rateLimitedResponse?.clone() ?? rateLimitResponse();
  }
  if (rateLimitedResponse) clearRefreshRateLimit();

  if (refreshInFlight) {
    logRefresh("already in progress");
    return (await refreshInFlight).clone();
  }

  logRefresh("started");
  const pending = fetch(input, init).then((response) => {
    if (response.status === 429) {
      rateLimitedResponse = response.clone();
      rateLimitedUntil = Date.now() + Math.max(
        retryDelayMs(response.headers.get("Retry-After")),
        DEFAULT_RATE_LIMIT_DELAY_MS,
      );
      try {
        window.sessionStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(rateLimitedUntil));
      } catch {
        // Session storage is optional outside standard browser contexts.
      }
      logRefresh("rate limited");
    } else {
      clearRefreshRateLimit();
      if (response.ok) logRefresh("completed");
    }
    return response;
  });
  refreshInFlight = pending;

  try {
    return (await pending).clone();
  } finally {
    if (refreshInFlight === pending) refreshInFlight = null;
  }
};

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
 main
