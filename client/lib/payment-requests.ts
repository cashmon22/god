import type { CreatePaymentRequestInput, PaymentRequest, PaymentRequestStatus } from "@shared/payment-requests";
import { apiRequest } from "./api-request";
import { notifyAdminReviewCountsChanged } from "./admin-dashboard";

export function createPaymentRequest(input: CreatePaymentRequestInput) {
  return apiRequest<PaymentRequest>("/api/payment-requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listPaymentRequests() {
  return apiRequest<PaymentRequest[]>("/api/payment-requests");
}

export async function updatePaymentRequestStatus(id: string, status: PaymentRequestStatus, rejectionReason?: string) {
  const result = await apiRequest<{ id: string; status: PaymentRequestStatus }>(`/api/admin/payment-requests/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, rejectionReason }),
  });
  notifyAdminReviewCountsChanged();
  return result;
}

export async function deletePaymentRequest(id: string) {
  const result = await apiRequest<{ id: string }>(`/api/admin/payment-requests/${id}`, {
    method: "DELETE",
  });
  notifyAdminReviewCountsChanged();
  return result;
}
