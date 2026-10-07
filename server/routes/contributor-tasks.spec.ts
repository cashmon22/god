import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";
import { startContributorTask } from "./contributor-tasks";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: vi.fn() } },
  createServiceRoleSupabaseClient: vi.fn(),
}));

const user = { id: "contributor-1", email: "contributor@example.test" };
let inserted: unknown;
let deviceApproved: boolean;

function request(body: unknown, authorization = "Bearer contributor-token") {
  return { headers: { authorization }, body } as unknown as Request;
}

function response() {
  const result: { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
  const res = {
    status(code: number) { result.statusCode = code; return res; },
    json(body: unknown) { result.body = body; return res; },
  } as unknown as Response;
  return { res, result };
}

async function invoke(req: Request) {
  const { res, result } = response();
  await startContributorTask(req, res, () => undefined);
  return result;
}

function queryFor(table: string) {
  let operation = "select";
  const query: any = {
    select() { return query; },
    insert(value: unknown) { operation = "insert"; inserted = value; return query; },
    eq() { return query; },
    order() { return query; },
    limit() { return query; },
    maybeSingle: async () => resolve(),
    single: async () => resolve(),
    then(onFulfilled: (value: any) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
  };
  const resolve = () => {
    if (table === "payment_requests") return { data: deviceApproved ? { id: "approved-device" } : null, error: null };
    if (table === "contributor_tasks" && operation === "insert") return {
      data: { id: "task-1", assignment_id: "asg-001", status: "Started", created_at: "2026-01-01T00:00:00Z" },
      error: null,
    };
    return { data: null, error: null };
  };
  return query;
}

beforeEach(() => {
  inserted = undefined;
  deviceApproved = true;
  vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user } as never, error: null });
  vi.mocked(createServiceRoleSupabaseClient).mockReturnValue({
    from: vi.fn((table: string) => queryFor(table)),
  } as never);
});

describe("startContributorTask", () => {
  it("persists an eligible, device-approved assignment for the authenticated user", async () => {
    const result = await invoke(request({ assignmentId: "asg-001", userId: "attacker-id" }));

    expect(result.statusCode).toBe(201);
    expect(inserted).toEqual({
      user_id: user.id,
      assignment_id: "asg-001",
      status: "In Progress",
      template_id: "product-research",
      template_version: 1,
      reward_min: 20,
      reward_max: 100,
      current_step: "product-information",
    });
  });

  it("requires an approved device", async () => {
    deviceApproved = false;

    const result = await invoke(request({ assignmentId: "asg-001" }));

    expect(result.statusCode).toBe(403);
    expect(inserted).toBeUndefined();
  });

  it("rejects unauthenticated requests", async () => {
    const result = await invoke(request({ assignmentId: "asg-001" }, ""));

    expect(result.statusCode).toBe(401);
    expect(inserted).toBeUndefined();
  });
});
