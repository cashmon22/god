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
