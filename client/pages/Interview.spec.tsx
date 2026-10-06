// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Interview from "./Interview";

const { api } = vi.hoisted(() => ({
  api: {
    getInterviewQuestions: vi.fn(),
    getMyInterview: vi.fn(),
    saveInterviewAnswer: vi.fn(),
    startTextInterview: vi.fn(),
    startInterviewQuestion: vi.fn(),
    submitInterview: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ session: { user: { email: "applicant@example.com" } }, signOut: vi.fn() }),
}));

vi.mock("@/lib/interviews", () => api);

const questions = Array.from({ length: 10 }, (_, position) => ({
  id: `00000000-0000-4000-8000-${String(position + 1).padStart(12, "0")}`,
  prompt: position === 0 ? "Question one prompt for the interview?" : `Question ${position + 1} prompt for the interview?`,
  position,
  created_at: "2026-10-19T00:00:00.000Z",
}));
const attemptId = "11111111-1111-4111-8111-111111111111";
const session = {
  id: attemptId,
  index: 0,
  answers: [],
  deadlineAt: null,
  serverNow: Date.now(),
  status: "Under Review",
};

function renderInterview() {
  return render(<MemoryRouter><Interview /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getInterviewQuestions.mockResolvedValue({ questions });
  api.getMyInterview.mockResolvedValue({ submission: null });
  api.startTextInterview.mockResolvedValue({ session, questions });
  api.startInterviewQuestion.mockImplementation(async () => ({
    session: { ...session, deadlineAt: Date.now() + 60_000, serverNow: Date.now() },
  }));
});

describe("Interview start flow", () => {
  it("renders Question 1 from a fresh attempt before starting its timer", async () => {
    renderInterview();
    fireEvent.click(await screen.findByRole("button", { name: /select text format/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start interview/i }));

    expect(api.startTextInterview).toHaveBeenCalledOnce();
    expect(await screen.findByText("Question one prompt for the interview?")).toBeTruthy();
    expect(screen.getByText("Question 1 of 10")).toBeTruthy();

    await waitFor(() => expect(api.startInterviewQuestion).toHaveBeenCalledWith(attemptId, 0));
  });

  it("does not start the question timer or render a blank screen when questions are missing", async () => {
    api.startTextInterview.mockResolvedValue({ session, questions: [] });
    renderInterview();
    fireEvent.click(await screen.findByRole("button", { name: /select text format/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start interview/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.startInterviewQuestion).not.toHaveBeenCalled();
  });
});
