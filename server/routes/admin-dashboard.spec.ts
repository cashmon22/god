import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";
import { getAdminReviewCounts } from "./admin-dashboard";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: vi.fn() } },
  createServiceRoleSupabaseClient: vi.fn(),
}));

const tableCounts = {
  applications: 3,
  interview_submissions: 2,
  payment_requests: 4,
  contributor_kyc_submissions: 1,
};

let filters: Array<{ table: string; filter: string; value: unknown }>;
let service: { from: ReturnType<typeof vi.fn> };

function request() {
  return { headers: { authorization: "Bearer admin-token" } } as unknown as Request;
}

function response() {
  const result: { statusCode: number; body: unknown; headers: Record<string, string> } = { statusCode: 200, body: undefined, headers: {} };
  const res = {
    status(code: number) { result.statusCode = code; return res; },
    json(body: unknown) { result.body = body; return res; },
    setHeader(name: string, value: string) { result.headers[name] = value; return res; },
  } as unknown as Response;
  return { res, result };
}

beforeEach(() => {
  filters = [];
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "admin-1", app_metadata: { role: "admin" } } } as never,
    error: null,
  });
  service = {
    from: vi.fn((table: keyof typeof tableCounts) => {
      const query = {
        select: () => query,
        eq: (filter: string, value: unknown) => { filters.push({ table, filter, value }); return query; },
        not: (filter: string, operator: string, value: unknown) => { filters.push({ table, filter: `${filter}:${operator}`, value }); return query; },
        in: (filter: string, value: unknown) => { filters.push({ table, filter, value }); return query; },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ count: tableCounts[table], error: null }).then(resolve, reject),
      };
      return query;
    }),
  };
  vi.mocked(createServiceRoleSupabaseClient).mockReturnValue(service as never);
});

describe("admin review counts", () => {
  it("returns pending counts from the protected queues", async () => {
    const { res, result } = response();
    await getAdminReviewCounts(request(), res, vi.fn() as never);

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      pendingApplications: 3,
      pendingInterviews: 2,
      pendingDeviceRequests: 4,
      pendingKyc: 1,
    });
    expect(result.headers["Cache-Control"]).toBe("no-store");
    expect(filters).toEqual(expect.arrayContaining([
      { table: "applications", filter: "status", value: "Under Review" },
      { table: "interview_submissions", filter: "status", value: "Under Review" },
      { table: "interview_submissions", filter: "submitted_at:is", value: null },
      { table: "payment_requests", filter: "status", value: ["Pending Review", "Under Review"] },
      { table: "contributor_kyc_submissions", filter: "status", value: "pending" },
    ]));
  });

  it("does not read database counts for non-admin users", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-1", app_metadata: {} } } as never,
      error: null,
    });
    const { res, result } = response();
    await getAdminReviewCounts(request(), res, vi.fn() as never);

    expect(result.statusCode).toBe(403);
    expect(service.from).not.toHaveBeenCalled();
  });
});
