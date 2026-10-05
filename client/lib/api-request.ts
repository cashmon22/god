import { getCurrentSession } from "./supabase";

/** Authenticated JSON request to the app's own Express API (/api/*). */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await getCurrentSession();
  if (!session) throw new Error("Your secure session has expired. Please sign in again.");

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (networkError) {
    console.error(`[api] Network error calling ${path}`, networkError);
    throw new Error("Could not reach the server. Check your internet connection and try again.");
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && payload.error
      ? payload.error
      : `The server returned an error (${response.status}). Please try again.`;
    console.error(`[api] ${init?.method ?? "GET"} ${path} failed`, response.status, payload);
    throw new Error(message);
  }
  return payload as T;
}
