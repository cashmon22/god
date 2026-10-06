// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
let preloadedAnswers: Array<{ questionId: string; question: string; answer: string }> = [];
let persistedAnswers: Array<{ questionId: string; question: string; answer: string }> = [];
let timeoutAtIndex: number | null = null;
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

async function beginAtQuestion(index: number, waitForTimer = true) {
  preloadedAnswers = questions.slice(0, index).map((question) => ({ questionId: question.id, question: question.prompt, answer: `Saved ${question.position + 1}` }));
  persistedAnswers = [...preloadedAnswers];
  api.startTextInterview.mockResolvedValue({ session: { ...session, index, answers: persistedAnswers }, questions });
  renderInterview();
  fireEvent.click(await screen.findByRole("button", { name: /select text format/i }));
  fireEvent.click(await screen.findByRole("button", { name: /start interview/i }));
  expect(await screen.findByText(questions[index].prompt)).toBeTruthy();
  await waitFor(() => expect(api.startInterviewQuestion).toHaveBeenCalledWith(attemptId, index));
  if (waitForTimer) {
    await waitFor(() => expect((screen.getByRole("button", { name: /next question|submit interview/i }) as HTMLButtonElement).disabled).toBe(false));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  preloadedAnswers = [];
  persistedAnswers = [];
  timeoutAtIndex = null;
  api.getInterviewQuestions.mockResolvedValue({ questions });
  api.getMyInterview.mockResolvedValue({ submission: null });
  api.startTextInterview.mockResolvedValue({ session, questions });
  api.startInterviewQuestion.mockImplementation(async (_id: string, index: number) => ({
    session: { ...session, index, answers: persistedAnswers, deadlineAt: Date.now() + (timeoutAtIndex === index ? 1_200 : 60_000), serverNow: Date.now() },
  }));
  api.saveInterviewAnswer.mockImplementation(async (_id: string, questionId: string, answer: string, index: number) => {
    const question = questions.find(({ id }) => id === questionId)!;
    persistedAnswers = [...persistedAnswers.filter((saved) => saved.questionId !== questionId), { questionId, question: question.prompt, answer }];
    return {
      session: { ...session, index, answers: persistedAnswers, deadlineAt: index === question.position ? Date.now() + 60_000 : null, serverNow: Date.now() },
    };
  });
  api.submitInterview.mockResolvedValue({ submission: { id: "completed", status: "Under Review", submitted_at: new Date().toISOString() } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Interview answer controls", () => {
  it("shows Next Question on Question 1", async () => {
    await beginAtQuestion(0);
    expect(screen.getByRole("button", { name: "Next Question" })).toBeTruthy();
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])("shows Next Question for question index %i", async (index) => {
    await beginAtQuestion(index);
    expect(screen.getByRole("button", { name: "Next Question" })).toBeTruthy();
  });

  it("shows Submit Interview on Question 10", async () => {
    await beginAtQuestion(9);
    expect(screen.getByRole("button", { name: "Submit Interview" })).toBeTruthy();
  });

  it("requires a manual answer, then saves it and advances without creating another attempt", async () => {
    await beginAtQuestion(0);
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.saveInterviewAnswer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "My response" } });
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));

    expect(await screen.findByText(questions[1].prompt)).toBeTruthy();
    expect(api.saveInterviewAnswer).toHaveBeenCalledWith(attemptId, questions[0].id, "My response", 1);
    expect(api.startTextInterview).toHaveBeenCalledOnce();
    await waitFor(() => expect(api.startInterviewQuestion).toHaveBeenCalledWith(attemptId, 1));
  });

  it("saves Question 10 before submitting the current attempt", async () => {
    await beginAtQuestion(9);
    expect(screen.getByText("Question 10 of 10")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit Interview" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Final response" } });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Final response");
    fireEvent.click(screen.getByRole("button", { name: "Submit Interview" }));

    await waitFor(() => expect(api.saveInterviewAnswer).toHaveBeenCalledWith(attemptId, questions[9].id, "Final response", 9));
    await waitFor(() => expect(api.submitInterview).toHaveBeenCalledWith(attemptId, expect.arrayContaining([
      expect.objectContaining({ questionId: questions[0].id, answer: "Saved 1" }),
      expect.objectContaining({ questionId: questions[9].id, answer: "Final response" }),
    ])));
    expect(await screen.findByText("Interview submitted")).toBeTruthy();
  });

  it("prevents duplicate submissions while the submit request is pending", async () => {
    let resolveSubmit!: (result: unknown) => void;
    api.submitInterview.mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    await beginAtQuestion(9);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Final response" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Interview" }));
    fireEvent.click(screen.getByRole("button", { name: /submitting/i }));

    await waitFor(() => expect(api.submitInterview).toHaveBeenCalledOnce());
    resolveSubmit({ submission: { id: "completed", status: "Under Review", submitted_at: new Date().toISOString() } });
    expect(await screen.findByText("Interview submitted")).toBeTruthy();
    expect(api.submitInterview).toHaveBeenCalledOnce();
  });

  it("automatically saves and advances when a question times out", async () => {
    api.startInterviewQuestion.mockImplementationOnce(async (_id: string, index: number) => ({
      session: { ...session, index, answers: persistedAnswers, deadlineAt: Date.now() - 1, serverNow: Date.now() },
    }));
    await beginAtQuestion(0, false);
    await waitFor(() => expect(api.saveInterviewAnswer.mock.calls).toContainEqual([attemptId, questions[0].id, "", 1]), { timeout: 2_000 });

    expect(api.saveInterviewAnswer.mock.calls).toContainEqual([attemptId, questions[0].id, "", 1]);
    expect(await screen.findByText(questions[1].prompt)).toBeTruthy();
  });

  it("automatically saves and submits Question 10 when it times out", async () => {
    api.startInterviewQuestion.mockImplementationOnce(async (_id: string, index: number) => ({
      session: { ...session, index, answers: persistedAnswers, deadlineAt: Date.now() - 1, serverNow: Date.now() },
    }));
    await beginAtQuestion(9, false);
    await waitFor(() => expect(api.submitInterview).toHaveBeenCalledOnce(), { timeout: 2_000 });

    expect(api.saveInterviewAnswer).toHaveBeenCalledWith(attemptId, questions[9].id, "", 9);
    await waitFor(() => expect(api.submitInterview).toHaveBeenCalledOnce());
    expect(await screen.findByText("Interview submitted")).toBeTruthy();
  });
});
