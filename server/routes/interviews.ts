import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { notifyUser } from "../lib/notifications";
import { getInterviewStatus } from "../lib/interview-access";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";

const questionSchema = z.object({ prompt: z.string().trim().min(5).max(1000) });
const answerSchema = z.object({ questionId: z.string().uuid(), prompt: z.string().min(5).max(1000), answer: z.string().trim().max(5000) });
const questionColumns = "id, prompt, position, created_at";
const submissionColumns = "id, user_id, applicant_name, email, status, answers, submitted_at, reviewed_at, interview_mode";

type InterviewQuestion = { id: string; prompt: string; position: number; created_at: string };
type InterviewAnswer = { questionId: string; question: string; answer: string };
type InterviewSession = {
  id: string;
  user_id: string;
  status: string;
  answers: InterviewAnswer[];
  interview_mode: "text" | "video" | null;
  current_question_index: number | null;
  question_start_times: string[];
  session_expired_at: string | null;
  submitted_at: string | null;
};
const QUESTION_DURATION_MS = 60_000;
const sessionColumns = "id, user_id, status, answers, interview_mode, current_question_index, question_start_times, session_expired_at, submitted_at";

function sessionPayload(session: InterviewSession, now = Date.now()) {
  const index = session.current_question_index ?? 0;
  const startedAt = Date.parse(session.question_start_times[index] ?? "");
  return {
    id: session.id,
    index,
    answers: session.answers ?? [],
    deadlineAt: Number.isFinite(startedAt) ? startedAt + QUESTION_DURATION_MS : null,
    serverNow: now,
  };
}

async function loadQuestions(service: ReturnType<typeof createServiceRoleSupabaseClient>) {
  return service.from("interview_questions").select("id, prompt, position, created_at").order("position").order("created_at");
}

function answerForQuestion(answers: InterviewAnswer[], question: InterviewQuestion, answer: string) {
  return [...answers.filter((existing) => existing.questionId !== question.id), { questionId: question.id, question: question.prompt, answer }];
}

function sessionResponse(session: InterviewSession) {
  const now = Date.now();
  return { session: { ...sessionPayload(session, now), status: session.status }, serverNow: now };
}

async function getUser(req: Request, res: Parameters<RequestHandler>[1]) {
  const authorization = req.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return data.user;
}

async function getAdminUser(req: Request, res: Parameters<RequestHandler>[1]) {
  const user = await getUser(req, res);
  if (!user) return null;
  if (user.app_metadata?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return null;
  }
  return user;
}

function serviceClient(res: Parameters<RequestHandler>[1]) {
  try {
    return createServiceRoleSupabaseClient();
  } catch {
    res.status(503).json({ error: "Interview data is not configured." });
    return null;
  }
}

export const getInterviewAccess: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  if (user.app_metadata?.role === "admin") {
    res.json({ status: "Approved", isAdmin: true });
    return;
  }
  try {
    res.json({ status: await getInterviewStatus(user) });
  } catch (error) {
    console.error("[api] Unable to verify interview approval.", error);
    res.status(500).json({ error: "Unable to verify interview approval." });
  }
};

export const getInterviewQuestions: RequestHandler = async (req, res) => {
  if (!(await getUser(req, res))) return;
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await loadQuestions(service);
  if (error) {
    console.error("[api] Unable to load interview questions.", error);
    res.status(500).json({ error: "Unable to load interview questions." });
    return;
  }
  res.json({ questions: data ?? [] });
};

export const startInterview: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  if (req.body?.mode !== "text") {
    res.status(400).json({ error: "Choose Text-Based Interview to begin the timed interview." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const [{ data: activeAttempt, error: activeError }, { data: submission, error: submissionError }, { data: questions, error: questionError }] = await Promise.all([
    service.from("interview_submissions").select(sessionColumns).eq("user_id", user.id).is("submitted_at", null).is("session_expired_at", null).maybeSingle(),
    service.from("interview_submissions").select("id, status").eq("user_id", user.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
    loadQuestions(service),
  ]);
  if (activeError || submissionError || questionError) {
    const migrationRequired = [activeError, submissionError, questionError].some((error) => error?.code === "42703");
    res.status(migrationRequired ? 503 : 500).json({ error: migrationRequired ? "The interview database update must be applied before timed interviews can start." : "Unable to start your interview." });
    return;
  }
  if (submission) {
    res.status(409).json({ error: "Your interview has already been submitted." });
    return;
  }
  if (!questions?.length) {
    res.status(409).json({ error: "Interview questions are not available yet." });
    return;
  }
  if (activeAttempt) {
    const { error } = await service.from("interview_submissions").update({ session_expired_at: new Date().toISOString() }).eq("id", activeAttempt.id).is("submitted_at", null).is("session_expired_at", null);
    if (error) {
      res.status(500).json({ error: "Unable to archive the previous interview attempt." });
      return;
    }
  }
  const applicantName = typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
    ? user.user_metadata.full_name.trim().slice(0, 200)
    : (user.email ?? "Applicant").slice(0, 200);
  const { data, error } = await service.from("interview_submissions").insert({
    user_id: user.id,
    applicant_name: applicantName,
    email: user.email ?? "",
    status: "Under Review",
    answers: [],
    interview_mode: "text",
    current_question_index: 0,
    question_start_times: [],
    submitted_at: null,
  }).select(sessionColumns).single();
  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: "A new interview attempt has already started. Reload to continue." });
      return;
    }
    console.error("[api] Unable to start interview session.", error);
    res.status(500).json({ error: "Unable to start your interview." });
    return;
  }
  res.status(201).json({ ...sessionResponse(data as InterviewSession), questions });
};

export const startInterviewQuestion: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const parsed = z.object({ sessionId: z.string().uuid(), questionIndex: z.number().int().min(0).max(99) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The interview question could not be started." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await service.rpc("start_interview_question", {
    p_session_id: parsed.data.sessionId,
    p_user_id: user.id,
    p_question_index: parsed.data.questionIndex,
  });
  const session = Array.isArray(data) ? data[0] as InterviewSession | undefined : data as InterviewSession | null;
  if (error || !session || session.user_id !== user.id) {
    res.status(error ? 500 : 409).json({ error: "This interview question is no longer active." });
    return;
  }
  res.json(sessionResponse(session));
};

export const saveInterviewAnswer: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const parsed = z.object({ sessionId: z.string().uuid(), questionId: z.string().uuid(), answer: z.string().max(5000), targetIndex: z.number().int().min(0).max(99) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Your answer could not be saved." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: sessionData, error: sessionError } = await service.from("interview_submissions").select(sessionColumns).eq("id", parsed.data.sessionId).eq("user_id", user.id).maybeSingle();
  if (sessionError || !sessionData) {
    res.status(sessionError ? 500 : 409).json({ error: "Start your interview before saving an answer." });
    return;
  }
  const session = sessionData as InterviewSession;
  if (session.session_expired_at || session.submitted_at !== null) {
    res.status(409).json({ error: "This interview session is no longer active." });
    return;
  }
  const { data: questions, error: questionError } = await loadQuestions(service);
  if (questionError || !questions?.length) {
    res.status(500).json({ error: "Unable to verify the current interview question." });
    return;
  }
  const currentIndex = session.current_question_index ?? 0;
  const targetIndex = parsed.data.targetIndex;
  const currentStartedAt = Date.parse(session.question_start_times[currentIndex] ?? "");
  if (!Number.isFinite(currentStartedAt)) {
    res.status(409).json({ error: "The question timer has not started yet." });
    return;
  }
  if (targetIndex < 0 || targetIndex >= questions.length || (targetIndex !== currentIndex && targetIndex !== currentIndex + 1) || questions[currentIndex]?.id !== parsed.data.questionId) {
    res.status(409).json({ error: "The interview question changed. Reload to continue." });
    return;
  }
  if (targetIndex === currentIndex + 1 && Date.now() < currentStartedAt + QUESTION_DURATION_MS) {
    res.status(409).json({ error: "This question is still in progress." });
    return;
  }
  const answers = answerForQuestion(session.answers ?? [], questions[currentIndex] as InterviewQuestion, parsed.data.answer);
  const timestamps = [...(session.question_start_times ?? [])];
  const { data, error } = await service.from("interview_submissions").update({ answers, current_question_index: targetIndex, question_start_times: timestamps }).eq("id", session.id).eq("current_question_index", currentIndex).is("submitted_at", null).is("session_expired_at", null).select(sessionColumns).single();
  if (error) {
    res.status(500).json({ error: "Unable to save your answer." });
    return;
  }
  const updatedSession = data as InterviewSession;
  res.json(sessionResponse(updatedSession));
};

export const getMyInterview: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await service.from("interview_submissions").select("id, status, answers, submitted_at, reviewed_at, interview_mode").eq("user_id", user.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  if (error?.code === "42703") {
    const { data: legacySubmission, error: legacyError } = await service.from("interview_submissions").select("id, status, answers, submitted_at, reviewed_at").eq("user_id", user.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
    if (legacyError) {
      res.status(500).json({ error: "Unable to load your interview." });
      return;
    }
    res.json({ submission: legacySubmission?.submitted_at ? legacySubmission : null, schemaUpgradeRequired: true });
    return;
  }
  if (error) {
    console.error("[api] Unable to load interview submission.", error);
    res.status(500).json({ error: "Unable to load your interview." });
    return;
  }
  res.json({ submission: data ?? null });
};

export const submitInterview: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const parsed = z.object({ sessionId: z.string().uuid(), answers: z.array(answerSchema).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please answer every interview question." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: sessionData, error: sessionError } = await service.from("interview_submissions").select(sessionColumns).eq("id", parsed.data.sessionId).eq("user_id", user.id).maybeSingle();
  if (sessionError || !sessionData) {
    res.status(sessionError ? 500 : 409).json({ error: "Start your interview before submitting answers." });
    return;
  }
  const session = sessionData as InterviewSession;
  if (session.session_expired_at || session.submitted_at !== null) {
    res.status(409).json({ error: "This interview session is no longer active." });
    return;
  }
  const { data: questions, error: questionError } = await loadQuestions(service);
  if (questionError) {
    res.status(500).json({ error: "Unable to load interview questions." });
    return;
  }
  const currentIndex = session.current_question_index ?? 0;
  const currentStartedAt = Date.parse(session.question_start_times[currentIndex] ?? "");
  if (!Number.isFinite(currentStartedAt)) {
    res.status(409).json({ error: "The interview question timing could not be verified." });
    return;
  }
  if (Date.now() < currentStartedAt + QUESTION_DURATION_MS) {
    res.status(409).json({ error: "Please complete the full time for this question before submitting." });
    return;
  }
  if (currentIndex !== (questions?.length ?? 0) - 1 || !questions?.length || parsed.data.answers.length !== questions.length || new Set(parsed.data.answers.map((answer) => answer.questionId)).size !== questions.length) {
    res.status(400).json({ error: "Please answer every current interview question." });
    return;
  }
  const questionById = new Map((questions as Pick<InterviewQuestion, "id" | "prompt">[]).map((question) => [question.id, question.prompt]));
  const answers: InterviewAnswer[] = parsed.data.answers.map(({ questionId, prompt, answer }) => ({ questionId, question: prompt, answer }));
  if (answers.some((answer) => questionById.get(answer.questionId) !== answer.question) || answers.some(({ questionId }) => !questionById.has(questionId))) {
    res.status(400).json({ error: "The interview questions have changed or an answer is missing." });
    return;
  }
  const submittedAt = new Date().toISOString();
  const { data, error } = await service.from("interview_submissions").update({ answers, submitted_at: submittedAt }).eq("id", session.id).is("submitted_at", null).is("session_expired_at", null).select("id, status, submitted_at").single();
  if (error) {
    console.error("[api] Unable to save interview submission.", error);
    res.status(500).json({ error: "Unable to submit your interview." });
    return;
  }
  res.status(201).json({ submission: data });
};

export const listAdminInterviews: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await service.from("interview_submissions").select(submissionColumns).not("submitted_at", "is", null).order("submitted_at", { ascending: false });
  if (error?.code === "42703") {
    const { data: legacySubmissions, error: legacyError } = await service.from("interview_submissions").select("id, user_id, applicant_name, email, status, answers, submitted_at, reviewed_at").not("submitted_at", "is", null).order("submitted_at", { ascending: false });
    if (legacyError) {
      res.status(500).json({ error: "Unable to load submitted interviews." });
      return;
    }
    res.json({ submissions: (legacySubmissions ?? []).map((submission) => ({ ...submission, interview_mode: null })) });
    return;
  }
  if (error) {
    res.status(500).json({ error: "Unable to load submitted interviews." });
    return;
  }
  res.json({ submissions: data ?? [] });
};

export const updateInterviewStatus: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const status = req.body?.status;
  if (status !== "Approved" && status !== "Rejected") {
    res.status(400).json({ error: "Choose Accept or Reject for this interview." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await service.from("interview_submissions").update({ status, reviewed_at: new Date().toISOString() }).eq("id", req.params.id).not("submitted_at", "is", null).select("id, user_id, applicant_name, status").maybeSingle();
  if (error) {
    res.status(500).json({ error: "Unable to update interview status." });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Interview submission not found." });
    return;
  }
  await notifyUser({
    userId: data.user_id,
    type: status === "Approved" ? "application_approved" : "application_rejected",
    title: `Interview ${status}`,
    message: `${data.applicant_name}'s interview has been ${status.toLowerCase()}.`,
    link: status === "Approved" ? "/dashboard" : "/interview",
    relatedId: data.id,
  });
  res.json({ id: data.id, status });
};

export const createInterviewQuestion: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Question text must be between 5 and 1000 characters." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: last, error: orderError } = await service.from("interview_questions").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
  if (orderError) {
    res.status(500).json({ error: "Unable to prepare a new interview question." });
    return;
  }
  const { data, error } = await service.from("interview_questions").insert({ prompt: parsed.data.prompt, position: (last?.position ?? -1) + 1 }).select(questionColumns).single();
  if (error) {
    res.status(500).json({ error: "Unable to create interview question." });
    return;
  }
  res.status(201).json({ question: data });
};

export const updateInterviewQuestion: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Question text must be between 5 and 1000 characters." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await service.from("interview_questions").update({ prompt: parsed.data.prompt }).eq("id", req.params.id).select(questionColumns).maybeSingle();
  if (error) {
    res.status(500).json({ error: "Unable to update interview question." });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Interview question not found." });
    return;
  }
  res.json({ question: data });
};

export const deleteInterviewQuestion: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await service.from("interview_questions").delete().eq("id", req.params.id).select("id").maybeSingle();
  if (error) {
    res.status(500).json({ error: "Unable to delete interview question." });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Interview question not found." });
    return;
  }
  res.json({ id: data.id });
};

export const reorderInterviewQuestions: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const ids = z.array(z.string().uuid()).min(1).max(100).safeParse(req.body?.ids);
  if (!ids.success || new Set(ids.data).size !== ids.data.length) {
    res.status(400).json({ error: "Provide each interview question exactly once, in the desired order." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: questions, error } = await service.from("interview_questions").select("id");
  if (error) {
    res.status(500).json({ error: "Unable to verify interview question order." });
    return;
  }
  if (questions?.length !== ids.data.length || ids.data.some((id) => !questions.some((question) => question.id === id))) {
    res.status(400).json({ error: "The question list changed. Reload and try again." });
    return;
  }
  const updates = await Promise.all(ids.data.map((id, position) => service.from("interview_questions").update({ position }).eq("id", id)));
  if (updates.some(({ error: updateError }) => updateError)) {
    res.status(500).json({ error: "Unable to save interview question order." });
    return;
  }
  res.json({ success: true });
};
