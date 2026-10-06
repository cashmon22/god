import { beforeEach, describe, expect, it, vi } from "vitest";
// @vitest-environment jsdom
import { apiRequest } from "./api-request";
import { deleteAdminApplication, updateAdminApplicationStatus } from "./admin-applications";
import { supabase } from "./supabase";

const { cooldownActive } = vi.hoisted(() => ({ cooldownActive: { value: false } }));

vi.mock("./admin-dashboard", () => ({ notifyAdminReviewCountsChanged: vi.fn() }));
vi.mock("./auth-refresh-fetch", () => ({
  isRefreshRateLimited: () => cooldownActive.value,
  recordApplicationRefreshRequest: vi.fn(() => () => {}),
}));

vi.mock("./supabase", () => ({
  getCurrentSession: vi.fn(() => supabase.auth.getSession()),
  supabase: {
    auth: {
      getSession: vi.fn(),
      refreshSession: vi.fn(),
    },
  },
}));

const auth = vi.mocked(supabase.auth);

function session(accessToken: string, expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  return { access_token: accessToken, expires_at: expiresAt } as Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("apiRequest authentication", () => {
  beforeEach(() => {
    cooldownActive.value = false;
    vi.mocked(auth.getSession).mockReset();
    vi.mocked(auth.refreshSession).mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does not start a competing refresh for an access token near expiry", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("current", Math.floor(Date.now() / 1000) + 20) }, error: null });
    vi.mocked(fetch).mockResolvedValue(response(200, { success: true }));

    await expect(apiRequest("/api/admin/applications/abc/status", { method: "PATCH", body: "{}" })).resolves.toEqual({ success: true });

    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer current");
  });

  it("refreshes after 401 and retries the protected action exactly once", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("old") }, error: null });
    vi.mocked(auth.refreshSession).mockResolvedValue({ data: { session: session("new"), user: null }, error: null } as never);
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(401, { error: "Authentication required" }))
      .mockResolvedValueOnce(response(200, { id: "abc", status: "Approved" }));

    await expect(apiRequest("/api/admin/applications/abc/status", { method: "PATCH", body: "{}" })).resolves.toEqual({ id: "abc", status: "Approved" });

    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map((call) => new Headers(call[1]?.headers).get("Authorization"))).toEqual([
      "Bearer old",
      "Bearer new",
    ]);
  });

  it("sends approve, reject, and delete actions through the shared authenticated helper", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("admin-token") }, error: null });
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(200, { id: "app-1", status: "Approved" }))
      .mockResolvedValueOnce(response(200, { id: "app-1", status: "Rejected" }))
      .mockResolvedValueOnce(response(200, { id: "app-1" }));

    await updateAdminApplicationStatus("app-1", "Approved");
    await updateAdminApplicationStatus("app-1", "Rejected");
    await deleteAdminApplication("app-1");

    expect(vi.mocked(fetch).mock.calls.map(([url, init]) => [url, init?.method, new Headers(init?.headers).get("Authorization")])).toEqual([
      ["/api/admin/applications/app-1/status", "PATCH", "Bearer admin-token"],
      ["/api/admin/applications/app-1/status", "PATCH", "Bearer admin-token"],
      ["/api/admin/applications/app-1", "DELETE", "Bearer admin-token"],
    ]);
  });

  it.each([
    [403, "Administrator access required", "Administrator access required"],
    [429, "Please slow down", "Please slow down"],
    [500, "Database unavailable", "Database unavailable"],
  ])("preserves the distinct %i response instead of reporting an expired session", async (status, serverMessage, expectedMessage) => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("valid") }, error: null });
    vi.mocked(fetch).mockResolvedValue(response(status, { error: serverMessage }));

    await expect(apiRequest("/api/admin/applications/abc/status", { method: "PATCH", body: "{}" })).rejects.toThrow(expectedMessage as string);

    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("serves five simultaneous near-expiry dashboard requests without app-triggered refreshes", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("current", Math.floor(Date.now() / 1000) + 20) }, error: null });
    vi.mocked(fetch).mockImplementation(async () => response(200, { success: true }));

    await expect(Promise.all([
      apiRequest("/api/admin/dashboard-stats"),
      apiRequest("/api/admin/review-counts"),
      apiRequest("/api/admin/applications"),
      apiRequest("/api/admin/users"),
      apiRequest("/api/admin/notifications"),
    ])).resolves.toEqual(Array(5).fill({ success: true }));

    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("refreshes once after an API 401 and retries that request exactly once", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("old") }, error: null });
    vi.mocked(auth.refreshSession).mockResolvedValue({ data: { session: session("new"), user: null }, error: null } as never);
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(401, { error: "Authentication required" }))
      .mockResolvedValueOnce(response(200, { success: true }));

    await expect(apiRequest("/api/admin/dashboard-stats")).resolves.toEqual({ success: true });

    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("requires login when Supabase reports a revoked refresh token after an API 401", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("expired", 0) }, error: null });
    vi.mocked(auth.refreshSession).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Refresh token is invalid", status: 400, code: "invalid_grant" },
    } as never);
    vi.mocked(fetch).mockResolvedValue(response(401, { error: "Authentication required" }));

    await expect(apiRequest("/api/admin/dashboard-stats")).rejects.toThrow("Your secure session has expired. Please sign in again.");
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not refresh again or discard the session while the 429 cooldown is active", async () => {
    cooldownActive.value = true;
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("still-valid") }, error: null });
    vi.mocked(fetch).mockResolvedValue(response(401, { error: "Authentication required" }));

    const results = await Promise.allSettled([
      apiRequest("/api/admin/applications/abc", { method: "DELETE" }),
      apiRequest("/api/admin/dashboard-stats"),
      apiRequest("/api/admin/dashboard-stats"),
    ]);

    expect(results.every((result) => result.status === "rejected" && result.reason.message === "Your session could not be refreshed right now. Please try again.")).toBe(true);
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(auth.getSession).toHaveBeenCalledTimes(3);
  });
});
