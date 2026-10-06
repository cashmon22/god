import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";
import { getMyInterview, startInterview, startInterviewQuestion } from "./interviews";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: vi.fn() } },
  createServiceRoleSupabaseClient: vi.fn(),
}));

const user = { id: "applicant-1", email: "applicant@example.com", user_metadata: {} };
const authRequest = { headers: { authorization: "Bearer test-only-access-token" } } as unknown as Request;

function response() {
  const result: { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
  const res = {
    status(code: number) { result.statusCode = code; return res; },
    json(body: unknown) { result.body = body; return res; },
  } as unknown as Response;
  return { res, result };
}

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "order", "limit", "update", "insert"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder as never;
}

beforeEach(() => {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user } as never, error: null });
});

describe("interview attempts", () => {
  it("does not restore or expire an old active attempt when the selection page loads", async () => {
    const lookup = query({ data: null, error: null });
    const service = { from: vi.fn(() => lookup) };
    vi.mocked(createServiceRoleSupabaseClient).mockReturnValue(service as never);

    const { res, result } = response();
    await getMyInterview(authRequest, res, vi.fn() as never);

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ submission: null });
  });

  it("archives the old attempt and creates a unique untimed attempt on explicit start", async () => {
    const oldAttempt = {
      id: "old-attempt",
      user_id: user.id,
      status: "Under Review",
      answers: [],
      interview_mode: "text",
      current_question_index: 0,
      question_start_times: [new Date(Date.now() - 61_000).toISOString()],
      session_expired_at: null,
      submitted_at: null,
    };
    const newAttempt = { ...oldAttempt, id: "11111111-1111-4111-8111-111111111111", question_start_times: [] };
    const questions = Array.from({ length: 10 }, (_, position) => ({
      id: `question-${position}`,
      prompt: `Question ${position}`,
      position,
      created_at: new Date().toISOString(),
    }));
    const activeLookup = query({ data: oldAttempt, error: null });
    const submittedLookup = query({ data: null, error: null });
    const questionLookup = query({ data: questions, error: null });
    const archiveUpdate = query({ data: null, error: null });
    const insertAttempt = query({ data: newAttempt, error: null });
    const submissions = [activeLookup, submittedLookup, archiveUpdate, insertAttempt];
    const service = {
      from: vi.fn((table: string) => table === "interview_submissions" ? submissions.shift() : questionLookup),
    };
    vi.mocked(createServiceRoleSupabaseClient).mockReturnValue(service as never);

    const { res, result } = response();
    await startInterview({ ...authRequest, body: { mode: "text" } } as Request, res, vi.fn() as never);

    expect(result.statusCode).toBe(201);
    expect(result.body).toMatchObject({ session: { id: "11111111-1111-4111-8111-111111111111", index: 0, deadlineAt: null } });
    expect((archiveUpdate as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(expect.objectContaining({ session_expired_at: expect.any(String) }));
    expect((insertAttempt as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: user.id,
      question_start_times: [],
      submitted_at: null,
    }));
  });

  it("starts the server timer only for the displayed question on the requested attempt", async () => {
    const startedAt = new Date().toISOString();
    const attempt = {
      id: "11111111-1111-4111-8111-111111111111",
      user_id: user.id,
      status: "Under Review",
      answers: [],
      interview_mode: "text",
      current_question_index: 0,
      question_start_times: [startedAt],
      session_expired_at: null,
      submitted_at: null,
    };
    const service = { rpc: vi.fn(async () => ({ data: [attempt], error: null })) };
    vi.mocked(createServiceRoleSupabaseClient).mockReturnValue(service as never);

    const { res, result } = response();
    await startInterviewQuestion({ ...authRequest, body: { sessionId: attempt.id, questionIndex: 0 } } as Request, res, vi.fn() as never);

    expect(service.rpc).toHaveBeenCalledWith("start_interview_question", {
      p_session_id: attempt.id,
      p_user_id: user.id,
      p_question_index: 0,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ session: { id: attempt.id, deadlineAt: Date.parse(startedAt) + 60_000 } });
  });
});
