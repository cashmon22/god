import { apiRequest } from "./api-request";
import { notifyAdminReviewCountsChanged } from "./admin-dashboard";

export type InterviewQuestion = { id: string; prompt: string; position: number; created_at: string };
export type InterviewAnswer = { questionId: string; question: string; answer: string };
export type InterviewSubmission = {
  id: string;
  user_id: string;
  applicant_name: string;
  email: string;
  status: "Under Review" | "Approved" | "Rejected";
  answers: InterviewAnswer[];
  submitted_at: string;
  reviewed_at: string | null;
};

export function getInterviewQuestions() {
  return apiRequest<{ questions: InterviewQuestion[] }>("/api/interview/questions");
}

export function getMyInterview() {
  return apiRequest<{ submission: Pick<InterviewSubmission, "id" | "status" | "answers" | "submitted_at" | "reviewed_at"> | null }>("/api/interview/me");
}

export function submitInterview(answers: Array<{ questionId: string; prompt: string; answer: string }>) {
  return apiRequest<{ submission: { id: string; status: InterviewSubmission["status"]; submitted_at: string } }>("/api/interview/submissions", {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export function listAdminInterviews() {
  return apiRequest<{ submissions: InterviewSubmission[] }>("/api/admin/interviews");
}

export async function updateInterviewStatus(id: string, status: "Approved" | "Rejected") {
  const result = await apiRequest<{ id: string; status: InterviewSubmission["status"] }>(`/api/admin/interviews/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  notifyAdminReviewCountsChanged();
  return result;
}

export function createInterviewQuestion(prompt: string) {
  return apiRequest<{ question: InterviewQuestion }>("/api/admin/interview-questions", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

export function updateInterviewQuestion(id: string, prompt: string) {
  return apiRequest<{ question: InterviewQuestion }>(`/api/admin/interview-questions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ prompt }),
  });
}

export function deleteInterviewQuestion(id: string) {
  return apiRequest<{ id: string }>(`/api/admin/interview-questions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function reorderInterviewQuestions(ids: string[]) {
  return apiRequest<{ success: boolean }>("/api/admin/interview-questions/order", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}
