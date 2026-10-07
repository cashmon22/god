import { apiRequest } from "./api-request";
import type { ProductResearchDraft, ProductResearchTask } from "@shared/product-research";

export function listResearchTasks() {
  return apiRequest<{ tasks: ProductResearchTask[] }>("/api/contributor/research-tasks");
}

export function acceptResearchTask(taskId: string) {
  return apiRequest<ProductResearchTask>(`/api/contributor/research-tasks/${encodeURIComponent(taskId)}/accept`, { method: "POST" });
}

export function getResearchTask(taskId: string) {
  return apiRequest<ProductResearchTask>(`/api/contributor/research-tasks/${encodeURIComponent(taskId)}`);
}

export function saveResearchTask(taskId: string, draft: ProductResearchDraft, currentStep: string) {
  return apiRequest<ProductResearchTask>(`/api/contributor/research-tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify({ draft, currentStep }),
  });
}

export function submitResearchTask(taskId: string, draft: ProductResearchDraft) {
  return apiRequest<ProductResearchTask & { submissionId: string }>(`/api/contributor/research-tasks/${encodeURIComponent(taskId)}/submit`, {
    method: "POST",
    body: JSON.stringify({ draft }),
  });
}

export interface AdminResearchTask {
  id: string;
  contributor: string;
  status: string;
  productName: string | null;
  progress: number;
  currentStep: string;
  startedAt: string;
  lastActivityAt: string;
  submittedAt: string | null;
  rewardMin: number | null;
  rewardMax: number | null;
}

export interface AdminResearchSubmission {
  id: string;
  revision: number;
  snapshot: { draft: ProductResearchDraft; template: unknown; productName: string; progress: number };
}

export interface AdminResearchReviewTask extends AdminResearchTask {
  changeRequest: string | null;
  submission: AdminResearchSubmission | null;
}

export function listAdminResearchTasks() {
  return apiRequest<{ tasks: AdminResearchTask[] }>("/api/admin/research-tasks");
}

export function createAdminResearchTask(userId: string, productName: string) {
  return apiRequest<AdminResearchTask>("/api/admin/research-tasks", { method: "POST", body: JSON.stringify({ userId, productName }) });
}

export function getAdminResearchTask(taskId: string) {
  return apiRequest<AdminResearchReviewTask>(`/api/admin/research-tasks/${encodeURIComponent(taskId)}`);
}

export function reviewAdminResearchTask(taskId: string, decision: "Approved" | "Changes Requested", message?: string) {
  return apiRequest<{ id: string; status: string }>(`/api/admin/research-tasks/${encodeURIComponent(taskId)}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, message }),
  });
}
