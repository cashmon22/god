import { apiRequest } from "./api-request";

export type AdminReviewCounts = {
  pendingApplications: number;
  pendingInterviews: number;
  pendingDeviceRequests: number;
  pendingKyc: number;
};

export const ADMIN_REVIEW_COUNTS_CHANGED_EVENT = "admin-review-counts-changed";

export function notifyAdminReviewCountsChanged() {
  window.dispatchEvent(new Event(ADMIN_REVIEW_COUNTS_CHANGED_EVENT));
}

export function getAdminReviewCounts(): Promise<AdminReviewCounts> {
  return apiRequest<AdminReviewCounts>("/api/admin/review-counts");
}

export type AdminDashboardStats = {
  users: number;
  applications: number;
  pendingApplications: number;
  deviceRequests: number;
  pendingDeviceRequests: number;
  pendingInterviews: number;
  activeConversations: number;
  availableDevices: number;
  availableBalance: number;
  pendingEarnings: number;
};

export function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  return apiRequest<AdminDashboardStats>("/api/admin/dashboard-stats");
}
