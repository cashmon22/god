import type { Session } from "@supabase/supabase-js";
import { getCurrentSession, supabase } from "./supabase";

const SESSION_EXPIRED_MESSAGE = "Your secure session has expired. Please sign in again.";
const REFRESH_UNAVAILABLE_MESSAGE = "Your session could not be refreshed right now. Please try again.";
let refreshInFlight: ReturnType<typeof supabase.auth.refreshSession> | null = null;

function refreshSession() {
  if (!refreshInFlight) {
    const pending = supabase.auth.refreshSession();
    refreshInFlight = pending;
    void pending.then(
      () => { if (refreshInFlight === pending) refreshInFlight = null; },
      () => { if (refreshInFlight === pending) refreshInFlight = null; },
    );
  }
  return refreshInFlight;
}

function isInvalidSessionError(error: { code?: string | undefined; status?: number | undefined } | null | undefined) {
  return error?.status === 401 || ["invalid_grant", "refresh_token_not_found", "refresh_token_already_used", "session_expired"].includes(error?.code ?? "");
}

async function currentSession(refresh = false): Promise<Session> {
  const { data: { session }, error } = refresh
    ? await refreshSession()
    : await getCurrentSession();
  if (error) {
    if (isInvalidSessionError(error)) throw new Error(SESSION_EXPIRED_MESSAGE);
    throw new Error(REFRESH_UNAVAILABLE_MESSAGE);
  }
  if (!session) throw new Error(SESSION_EXPIRED_MESSAGE);
  return session;
}

function requestHeaders(init: RequestInit | undefined, accessToken: string) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return headers;
}

async function send(path: string, init: RequestInit | undefined, accessToken: string) {
  return fetch(path, { ...init, headers: requestHeaders(init, accessToken) });
}

function responseError(status: number, message?: string) {
  if (status === 401) return new Error(SESSION_EXPIRED_MESSAGE);
  if (status === 403) return new Error(message || "You are not authorized to perform this action.");
  if (status === 429) return new Error(message || "Too many requests. Please wait and try again.");
  if (status >= 500) return new Error(message || "A server error occurred. Please try again.");
  return new Error(message || `The server returned an error (${status}). Please try again.`);
}

/** Authenticated JSON request to the app's own Express API (/api/*). */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    let session = await currentSession();
    let refreshed = false;
    if (session.expires_at !== undefined && session.expires_at <= Math.floor(Date.now() / 1000) + 30) {
      session = await currentSession(true);
      refreshed = true;
    }

    let response = await send(path, init, session.access_token);
    if (response.status === 401 && !refreshed) {
      session = await currentSession(true);
      refreshed = true;
      response = await send(path, init, session.access_token);
    }

    const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : undefined;
      console.error(`[api] ${init?.method ?? "GET"} ${path} failed`, response.status, payload);
      throw responseError(response.status, message);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && [SESSION_EXPIRED_MESSAGE, REFRESH_UNAVAILABLE_MESSAGE].includes(error.message)) throw error;
    if (error instanceof TypeError) {
      console.error(`[api] Network error calling ${path}`, error);
      throw new Error("Could not reach the server. Check your internet connection and try again.");
    }
    throw error;
  }
}
