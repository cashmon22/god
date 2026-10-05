import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";
import { getAdminContributorOverview } from "./admin-users";
import { getMyApplication } from "./admin-applications";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: vi.fn() } },
  createServiceRoleSupabaseClient: vi.fn(),
}));

const contributor = {
  id: "contributor-1",
  email: "contributor@example.test",
  app_metadata: { role: "admin" },
  user_metadata: { phone: "555-0100" },
};
const application = {
  submission_id: "application-1",
  first_name: "Taylor",
  last_name: "Contributor",
  email: contributor.email,
  phone: "555-0101",
  status: "Under Review",
  verification_status: "Not Verified",
  created_at: "2026-01-01T00:00:00Z",
};

let applicationRows: typeof application[];
let applicationCalls: Array<{ filters: Array<[string, unknown]> }>;
let relatedRows: Record<string, any>;
let contributorTasksError: { code: string; message: string } | null;
let service: any;

function createService() {
  applicationCalls = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const query: any = {
      select() { return query; },
      eq(column: string, value: unknown) { filters.push([column, value]); return query; },
      not() { return query; },
      ilike(column: string, value: unknown) { filters.push([column, value]); return query; },
      order() { return query; },
      limit() { return query; },
      maybeSingle() {
        if (table === "applications") applicationCalls.push({ filters: [...filters] });
        const data = table === "applications" ? applicationRows[0] ?? null : relatedRows[table] ?? null;
        return Promise.resolve({ data, error: null });
      },
      then(onFulfilled: (value: any) => unknown, onRejected?: (reason: unknown) => unknown) {
        if (table === "applications") applicationCalls.push({ filters: [...filters] });
        if (table === "contributor_tasks" && contributorTasksError) {
          return Promise.resolve({ data: null, error: contributorTasksError }).then(onFulfilled, onRejected);
        }
        const data = table === "applications" ? applicationRows : relatedRows[table] ?? [];
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
      },
    };
    return query;
  };

  service = {
    from,
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: contributor }, error: null })),
      },
    },
  };
  vi.mocked(createServiceRoleSupabaseClient).mockReturnValue(service);
}

function request(id = contributor.id) {
  return {
    headers: { authorization: "Bearer test-token" },
    params: { id },
  } as unknown as Request;
}

function response() {
  const result: { statusCode: number; body: any } = { statusCode: 200, body: undefined };
  const res = {
    status(code: number) { result.statusCode = code; return res; },
    json(body: unknown) { result.body = body; return res; },
  } as unknown as Response;
  return { res, result };
}

async function invoke(handler: unknown, req: Request) {
  const { res, result } = response();
  await (handler as (req: Request, res: Response) => Promise<void>)(req, res);
  return result;
}

beforeEach(() => {
  applicationRows = [];
  relatedRows = {
    payment_requests: [],
    contributor_tasks: [],
    contributor_earnings: null,
    vendor_conversations: [],
  };
  contributorTasksError = null;
  vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: contributor } as never, error: null });
  createService();
});

describe("contributor application lookups", () => {
  it("loads an application in the admin contributor overview by email", async () => {
    applicationRows = [application];

    const result = await invoke(getAdminContributorOverview, request());

    expect(result.statusCode).toBe(200);
    expect(result.body.application).toMatchObject({
      fullName: "Taylor Contributor",
      email: contributor.email,
      phone: "555-0101",
      status: "Under Review",
    });
    expect(result.body.deviceRequests).toEqual([]);
    expect(result.body.tasks).toEqual([]);
    expect(result.body.earnings).toBeNull();
    expect(result.body.conversations).toEqual([]);
    expect(applicationCalls).toContainEqual({ filters: [["email", contributor.email]] });
  });

  it("returns an empty application state in the admin overview", async () => {
    const result = await invoke(getAdminContributorOverview, request());

    expect(result.statusCode).toBe(200);
    expect(result.body.application).toBeNull();
    expect(result.body.deviceRequests).toEqual([]);
    expect(result.body.tasks).toEqual([]);
    expect(result.body.earnings).toBeNull();
    expect(result.body.conversations).toEqual([]);
  });

  it("returns empty optional data when the contributor has no device requests", async () => {
    const result = await invoke(getAdminContributorOverview, request());

    expect(result.statusCode).toBe(200);
    expect(result.body.deviceRequests).toEqual([]);
  });

  it("returns empty optional data when the contributor has no earnings record", async () => {
    const result = await invoke(getAdminContributorOverview, request());

    expect(result.statusCode).toBe(200);
    expect(result.body.earnings).toBeNull();
  });

  it("returns empty optional data when the contributor has no conversations", async () => {
    const result = await invoke(getAdminContributorOverview, request());

    expect(result.statusCode).toBe(200);
    expect(result.body.conversations).toEqual([]);
  });

  it("returns an empty task list when contributor_tasks is absent from the schema cache", async () => {
    contributorTasksError = {
      code: "PGRST205",
      message: "Could not find the table 'public.contributor_tasks' in the schema cache",
    };

    const result = await invoke(getAdminContributorOverview, request());

    expect(result.statusCode).toBe(200);
    expect(result.body.tasks).toEqual([]);
  });

  it("returns 500 for genuine contributor task query failures", async () => {
    contributorTasksError = { code: "08006", message: "Database connection failure" };

    const result = await invoke(getAdminContributorOverview, request());

    expect(result.statusCode).toBe(500);
  });

  it("returns a complete overview when all related data exists", async () => {
    applicationRows = [application];
    relatedRows.payment_requests = [{
      id: "request-1",
      device_name: "Laptop",
      device_model: "Model X",
      status: "Approved",
      created_at: "2026-01-02T00:00:00Z",
    }];
    relatedRows.contributor_tasks = [{
      id: "task-1",
      assignment_id: "asg-001",
      status: "Started",
      created_at: "2026-01-03T00:00:00Z",
    }];
    relatedRows.contributor_earnings = {
      available_balance: "25.50",
      pending_earnings: "7.25",
      total_withdrawn: "3.00",
    };
    relatedRows.vendor_conversations = [{
      id: "conversation-1",
      conversation_type: "support",
      status: "active",
      last_message: "Need help",
      last_message_at: "2026-01-04T00:00:00Z",
      admin_unread_count: 2,
    }];

    const result = await invoke(getAdminContributorOverview, request());

    expect(result.statusCode).toBe(200);
    expect(result.body.application.fullName).toBe("Taylor Contributor");
    expect(result.body.deviceRequests).toHaveLength(1);
    expect(result.body.tasks).toMatchObject([{ id: "task-1", title: "Product Feature Research" }]);
    expect(result.body.earnings).toEqual({ availableBalance: 25.5, pendingEarnings: 7.25, totalWithdrawn: 3 });
    expect(result.body.conversations).toMatchObject([{ id: "conversation-1", unreadCount: 2 }]);
  });

  it("loads the signed-in user's application by email", async () => {
    applicationRows = [application];

    const result = await invoke(getMyApplication, request());

    expect(result.statusCode).toBe(200);
    expect(result.body.application).toEqual({
      id: "application-1",
      status: "Under Review",
      verificationStatus: "Not Verified",
      submittedAt: application.created_at,
    });
    expect(applicationCalls).toContainEqual({ filters: [["email", contributor.email]] });
  });

  it("returns null when the signed-in user has no application", async () => {
    const result = await invoke(getMyApplication, request());

    expect(result.statusCode).toBe(200);
    expect(result.body.application).toBeNull();
  });

  it("never uses user_id for application lookups", async () => {
    applicationRows = [application];
    await invoke(getAdminContributorOverview, request());
    await invoke(getMyApplication, request());

    expect(applicationCalls.length).toBeGreaterThan(0);
    expect(applicationCalls.flatMap((call) => call.filters).every(([column]) => column !== "user_id")).toBe(true);
  });
});
