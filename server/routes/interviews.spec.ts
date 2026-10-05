import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";
import { getMyInterview } from "./interviews";

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: vi.fn() } },
  createServiceRoleSupabaseClient: vi.fn(),
}));

function response() {
  const result: { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
  const res = {
    status(code: number) { result.statusCode = code; return res; },
    json(body: unknown) { result.body = body; return res; },
  } as unknown as Response;
  return { res, result };
}

describe("interview session timing", () => {
  it("keeps an active session signed in after one question reaches its 60-second deadline", async () => {
    const update = { eq: vi.fn(), is: vi.fn() };
    update.eq.mockImplementation(() => update);
    update.is.mockImplementation(() => update);
    Object.assign(update, { then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve, reject) });
    const session = {
      id: "session-1",
      status: "Under Review",
      answers: [{ questionId: "question-1", question: "Prompt", answer: "Draft" }],
      interview_mode: "text",
      current_question_index: 0,
      question_start_times: [new Date(Date.now() - 61_000).toISOString()],
      session_expired_at: null,
      submitted_at: null,
    };
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: session, error: null })),
    };
    const signOut = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: "applicant-1" } } as never, error: null });
    vi.mocked(createServiceRoleSupabaseClient).mockReturnValue({
      from: vi.fn((table: string) => table === "interview_submissions" ? { ...query, update: vi.fn(() => update) } : query),
      auth: { admin: { signOut } },
    } as never);

    const { res, result } = response();
    await getMyInterview({ headers: { authorization: "Bearer test-only-access-token" } } as unknown as Request, res, vi.fn() as never);

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ session: { index: 0 } });
    expect(signOut).not.toHaveBeenCalled();
  });
});
