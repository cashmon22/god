import { apiRequest } from "./api-request";
import { supabase } from "./supabase";
import { notifyAdminReviewCountsChanged } from "./admin-dashboard";

export type KycStatus = "draft" | "pending" | "approved" | "rejected";
export type KycIdentityInformation = { fullName: string; dateOfBirth: string; documentNumber: string; expiryDate: string };
export type KycIdType = { id: string; label: string; instructions: string };
export type KycInstructions = { instructions: string; acceptedIdTypes: KycIdType[]; updatedAt?: string };
export type KycSubmission = {
  id: string;
  user_id: string;
  status: KycStatus;
  consent_at: string | null;
  id_type: string | null;
  id_image_path: string | null;
  selfie_image_path: string | null;
  id_image_url?: string | null;
  selfie_image_url?: string | null;
  identity_information: KycIdentityInformation;
  quality_flags: string[];
  capture_confirmations?: { idPhotoReadable?: boolean; selfieCentered?: boolean };
  rejection_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  contributor_email?: string;
  contributor_name?: string;
};

export function getMyKyc() {
  return apiRequest<{ deviceApproved: boolean; submission: KycSubmission | null }>("/api/kyc/me");
}

export function getMyKycStatus() {
  return apiRequest<{ deviceApproved: boolean; status: KycStatus | null; rejectionReason: string | null }>("/api/kyc/status");
}

export function getKycInstructions() {
  return apiRequest<KycInstructions>("/api/kyc/instructions");
}

export function createKycDraft() {
  return apiRequest<{ submission: { id: string; status: KycStatus; created_at: string } }>("/api/kyc/drafts", { method: "POST", body: JSON.stringify({}) });
}

export function saveKycDraft(id: string, payload: {
  consent?: boolean;
  idType?: string;
  idImagePath?: string | null;
  selfieImagePath?: string | null;
  identityInformation?: KycIdentityInformation;
  qualityFlags?: string[];
  confirmations?: { idPhotoReadable: boolean; selfieCentered: boolean };
}) {
  return apiRequest<{ success: boolean }>(`/api/kyc/drafts/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function uploadKycFile(id: string, kind: "id" | "selfie", file: Blob, contentType: string) {
  const result = await apiRequest<{ path: string }>(`/api/kyc/drafts/${id}/files/${kind}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: file,
  });
  return result.path;
}

export function submitKyc(submissionId: string) {
  return apiRequest<{ status: "pending" }>("/api/kyc/submit", { method: "POST", body: JSON.stringify({ submissionId }) });
}

export function getAdminKyc(status?: "pending" | "approved" | "rejected") {
  const query = status ? `?status=${status}` : "";
  return apiRequest<{ counts: Record<"pending" | "approved" | "rejected", number>; submissions: KycSubmission[] }>(`/api/admin/kyc${query}`);
}

export function getAdminKycSubmission(id: string) {
  return apiRequest<{ submission: KycSubmission }>(`/api/admin/kyc/${id}`);
}

export async function reviewKyc(id: string, status: "approved" | "rejected", rejectionReason?: string) {
  const result = await apiRequest<{ status: "approved" | "rejected" }>(`/api/admin/kyc/${id}/review`, { method: "PATCH", body: JSON.stringify({ status, rejectionReason }) });
  notifyAdminReviewCountsChanged();
  return result;
}

export function getAdminKycInstructions() {
  return apiRequest<KycInstructions>("/api/admin/kyc/instructions");
}

export function saveAdminKycInstructions(value: Pick<KycInstructions, "instructions" | "acceptedIdTypes">) {
  return apiRequest<{ success: boolean }>("/api/admin/kyc/instructions", { method: "PUT", body: JSON.stringify(value) });
}
