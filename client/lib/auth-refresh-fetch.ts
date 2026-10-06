const DEFAULT_RATE_LIMIT_DELAY_MS = 60_000;
const RATE_LIMIT_STORAGE_KEY = "app.supabase.auth.refresh-rate-limit-until";

let rateLimitedResponse: Response | null = null;
let rateLimitedUntil = readRateLimitUntil();
let activeRefreshRequests = 0;
let activeApplicationRefreshes = 0;
let applicationRefreshAttempts = 0;
let browserAuthClients = 0;

function authDiagnostic(event: string, details: Record<string, string | number | boolean>) {
  console.info(`[auth] ${event}`, details);
}

export function trackSupabaseClient(kind: "primary" | "isolated") {
  browserAuthClients += 1;
  authDiagnostic("client-created", { kind, browserAuthClients });
  return () => {
    browserAuthClients = Math.max(0, browserAuthClients - 1);
    authDiagnostic("client-disposed", { kind, browserAuthClients });
  };
}

function safeDiagnosticSource(source: string) {
  return source.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id").slice(0, 120);
}

export function recordSessionRead(source: string) {
  authDiagnostic("session-read", { source: safeDiagnosticSource(source), refreshInProgress: activeRefreshRequests > 0, cooldownActive: isRefreshRateLimited() });
}

export function recordApplicationRefreshRequest(source: string) {
  applicationRefreshAttempts += 1;
  activeApplicationRefreshes += 1;
  authDiagnostic("application-refresh-requested", {
    source: safeDiagnosticSource(source),
    applicationRefreshAttempts,
    refreshInProgress: activeApplicationRefreshes > 1 || activeRefreshRequests > 0,
    cooldownActive: isRefreshRateLimited(),
    browserAuthClients,
  });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    activeApplicationRefreshes = Math.max(0, activeApplicationRefreshes - 1);
  };
}

function safeRefreshSource(input: RequestInfo | URL) {
  const url = input instanceof Request ? input.url : input.toString();
  const pathname = new URL(url, window.location.origin).pathname;
  return pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id");
}

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
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay)
    ? Math.max(1_000, delay)
    : DEFAULT_RATE_LIMIT_DELAY_MS;
}

function rateLimitResponse(): Response {
  const retryAfter = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
  return new Response(JSON.stringify({
    code: "over_request_rate_limit",
    message: "Auth refresh is temporarily rate limited.",
  }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
  });
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
    authDiagnostic("refresh-suppressed", { source: safeRefreshSource(input), refreshInProgress: activeRefreshRequests > 0, cooldownActive: true, browserAuthClients });
    return rateLimitedResponse?.clone() ?? rateLimitResponse();
  }

  activeRefreshRequests += 1;
  authDiagnostic("refresh-network-requested", { source: safeRefreshSource(input), refreshInProgress: activeRefreshRequests > 1, cooldownActive: false, browserAuthClients });
  try {
    const response = await fetch(input, init);
    if (response.status === 429) {
      rateLimitedResponse = response.clone();
      rateLimitedUntil = Date.now() + retryDelayMs(response.headers.get("Retry-After"));
      try {
        window.sessionStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(rateLimitedUntil));
      } catch {
        // Session storage is optional outside standard browser contexts.
      }
      authDiagnostic("refresh-rate-limited", { source: safeRefreshSource(input), cooldownActive: true, retryAfterSeconds: Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000)), browserAuthClients });
    } else if (rateLimitedResponse) {
      clearRefreshRateLimit();
    }
    return response;
  } finally {
    activeRefreshRequests = Math.max(0, activeRefreshRequests - 1);
  }
};
