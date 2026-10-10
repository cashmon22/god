import { apiRequest } from "./api-request";

export type CheckPaymentDetails = {
  payeeName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
};

export type BankingDetailsStatus = {
  submitted: boolean;
  submittedAt: string | null;
};

export type AdminBankingDetails = BankingDetailsStatus & {
  paymentStatus: string;
  kycStatus: string;
  deviceApprovalStatus: string;
  bankingDetails: CheckPaymentDetails | null;
};

export function getMyBankingDetailsStatus(requestId: string) {
  return apiRequest<BankingDetailsStatus>(`/api/payment-requests/${requestId}/banking-details`);
}

export function submitBankingDetails(requestId: string, details: CheckPaymentDetails) {
  return apiRequest<BankingDetailsStatus>(`/api/payment-requests/${requestId}/banking-details`, {
    method: "POST",
    body: JSON.stringify(details),
  });
}

export function getAdminBankingDetails(requestId: string) {
  return apiRequest<AdminBankingDetails>(`/api/admin/payment-requests/${requestId}/banking-details`);
}
