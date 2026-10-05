import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api-request";
import { deleteAdminApplication, updateAdminApplicationStatus } from "./admin-applications";
import { supabase } from "./supabase";

vi.mock("./admin-dashboard", () => ({ notifyAdminReviewCountsChanged: vi.fn() }));

vi.mock("./supabase", () => ({
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

  it("does not retry a protected request or report sign-out when refresh is temporarily unavailable", async () => {
    vi.mocked(auth.getSession).mockResolvedValue({ data: { session: session("old") }, error: null });
    vi.mocked(auth.refreshSession).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Rate limited", status: 503, code: "over_request_rate_limit" },
    } as never);
    vi.mocked(fetch).mockResolvedValue(response(401, { error: "Authentication required" }));

    await expect(apiRequest("/api/admin/applications/abc", { method: "DELETE" })).rejects.toThrow("Your session could not be refreshed right now. Please try again.");

    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
