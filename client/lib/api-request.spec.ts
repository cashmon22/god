import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api-request";
import { deleteAdminApplication, updateAdminApplicationStatus } from "./admin-applications";
import { supabase } from "./supabase";

vi.mock("./admin-dashboard", () => ({ notifyAdminReviewCountsChanged: vi.fn() }));

vi.mock("./supabase", () => ({
  getCurrentSession: () => supabase.auth.getSession(),
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
    vi.mocked(auth.getSession).mockReset();
    vi.mocked(auth.refreshSession).mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("refreshes an expired token before sending the protected request", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("expired", 0) }, error: null });
    vi.mocked(auth.refreshSession).mockResolvedValue({ data: { session: session("current"), user: null }, error: null } as never);
    vi.mocked(fetch).mockResolvedValue(response(200, { success: true }));

    await expect(apiRequest("/api/admin/applications/abc/status", { method: "PATCH", body: "{}" })).resolves.toEqual({ success: true });

    expect(auth.refreshSession).toHaveBeenCalledOnce();
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

  it("shares one refresh result across concurrent requests", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("expired", 0) }, error: null });
    let resolveRefresh!: (result: unknown) => void;
    vi.mocked(auth.refreshSession).mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }) as never);
    vi.mocked(fetch).mockImplementation(async () => response(200, { success: true }));

    const firstRequest = apiRequest("/api/admin/dashboard-stats");
    const secondRequest = apiRequest("/api/admin/review-counts");
    await Promise.resolve();
    await Promise.resolve();
    expect(auth.refreshSession).toHaveBeenCalledOnce();

    resolveRefresh({ data: { session: session("current"), user: null }, error: null });
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      { success: true },
      { success: true },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map((call) => new Headers(call[1]?.headers).get("Authorization"))).toEqual([
      "Bearer current",
      "Bearer current",
    ]);
  });

  it("requires login when Supabase reports a revoked refresh token", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("expired", 0) }, error: null });
    vi.mocked(auth.refreshSession).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Refresh token is invalid", status: 400, code: "invalid_grant" },
    } as never);

    await expect(apiRequest("/api/admin/dashboard-stats")).rejects.toThrow("Your secure session has expired. Please sign in again.");
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not retry protected requests or sign out when refresh is rate limited", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("old") }, error: null });
    vi.mocked(auth.refreshSession).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Rate limited", status: 429, code: "over_request_rate_limit" },
    } as never);
    vi.mocked(fetch).mockResolvedValue(response(401, { error: "Authentication required" }));

    const results = await Promise.allSettled([
      apiRequest("/api/admin/applications/abc", { method: "DELETE" }),
      apiRequest("/api/admin/dashboard-stats"),
    ]);

    expect(results.every((result) => result.status === "rejected" && result.reason.message === "Your session could not be refreshed right now. Please try again.")).toBe(true);
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
