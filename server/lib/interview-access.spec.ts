import type { Request, Response, NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleSupabaseClient, supabase } from "./supabase";
import { requireInterviewApproval } from "./interview-access";

vi.mock("./supabase", () => ({
  supabase: { auth: { getUser: vi.fn() } },
  createServiceRoleSupabaseClient: vi.fn(),
}));

const user = { id: "applicant-1", app_metadata: {} };
let interviewStatus: string | null;

function createRequest(overrides: Partial<Request> = {}) {
  return {
    headers: { authorization: "Bearer access-token" },
    method: "GET",
    originalUrl: "/api/contributor/tasks",
    ...overrides,
  } as unknown as Request;
}

function createResponse() {
  const result = { statusCode: 200, body: undefined as unknown };
  const response = {
    status(code: number) { result.statusCode = code; return response; },
    json(body: unknown) { result.body = body; return response; },
  } as unknown as Response;
  return { response, result };
}

async function invoke(req = createRequest()) {
  const { response, result } = createResponse();
  const next = vi.fn() as unknown as NextFunction;
  await requireInterviewApproval(req, response, next);
  return { result, next };
}

beforeEach(() => {
  vi.clearAllMocks();
  interviewStatus = "Under Review";
  vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user } as never, error: null });
  const lookup = {
    maybeSingle: vi.fn(async () => ({ data: interviewStatus ? { status: interviewStatus } : null, error: null })),
    limit: vi.fn(() => lookup),
    order: vi.fn(() => lookup),
    not: vi.fn(() => lookup),
  };
  vi.mocked(createServiceRoleSupabaseClient).mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => lookup) })),
    })),
  } as never);
});

describe("requireInterviewApproval", () => {
  it("blocks applicants until an interview is approved", async () => {
    const { result, next } = await invoke();
    expect(result.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows approved applicants", async () => {
    interviewStatus = "Approved";
    const { result, next } = await invoke();
    expect(result.statusCode).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows administrators", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { ...user, app_metadata: { role: "admin" } } } as never, error: null });
    const { next } = await invoke();
    expect(next).toHaveBeenCalledOnce();
    expect(createServiceRoleSupabaseClient).not.toHaveBeenCalled();
  });

  it("keeps the support conversation available to applicants", async () => {
    const { next } = await invoke(createRequest({ method: "GET", originalUrl: "/api/vendor-conversations/support" }));
    expect(next).toHaveBeenCalledOnce();
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });
});
