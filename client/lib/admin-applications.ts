import type { AdminApplication, AdminApplicationStatus, AdminApplicationsResponse, VerificationStatus } from "@shared/admin-applications";
import { supabase } from "./supabase";
import { notifyAdminReviewCountsChanged } from "./admin-dashboard";
import { apiRequest } from "./api-request";

type ApplicationRow = {
  id: string;
  submission_id: string;
  created_at: string;
  status: AdminApplicationStatus;
  verification_status: VerificationStatus;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  country: string;
  time_zone: string;
  assignment_categories: unknown;
  weekly_hours: string;
  previous_experience: string;
  motivation: string;
  age_18_plus: boolean;
  reliable_internet: boolean;
  follows_instructions: boolean;
  agrees_policies: boolean;
  understands_review: boolean;
};

const applicationFields =
  "id, submission_id, created_at, status, verification_status, first_name, last_name, email, phone, country, time_zone, assignment_categories, weekly_hours, previous_experience, motivation, age_18_plus, reliable_internet, follows_instructions, agrees_policies, understands_review";

const eligibilityLabels = [
  "I am at least 18 years old.",
  "I have reliable internet access.",
  "I can follow assignment instructions accurately.",
  "I agree to Contributor Program policies.",
  "I understand applications are reviewed before approval.",
];

function rowEligibility(row: ApplicationRow): string[] {
  return [
    row.age_18_plus && eligibilityLabels[0],
    row.reliable_internet && eligibilityLabels[1],
    row.follows_instructions && eligibilityLabels[2],
    row.agrees_policies && eligibilityLabels[3],
    row.understands_review && eligibilityLabels[4],
  ].filter(Boolean) as string[];
}

function rowToApplication(row: ApplicationRow): AdminApplication {
  return {
    id: row.submission_id,
    applicantName: `${row.first_name} ${row.last_name}`.trim() || "Unnamed applicant",
    email: row.email,
    phone: row.phone,
    country: row.country,
    applicationDate: row.created_at,
    status: row.status,
    verificationStatus: row.verification_status,
    details: {
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      country: row.country,
      timeZone: row.time_zone,
      interests: row.assignment_categories,
      hours: row.weekly_hours,
      experience: row.previous_experience,
      reason: row.motivation,
      eligibility: rowEligibility(row),
    },
  };
}

async function getApplicationRows() {
  const { data, error } = await supabase
    .from("applications")
    .select(applicationFields)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApplicationRow[];
}

export async function listAdminApplications(
  search: string,
  status: AdminApplicationStatus | "",
  verification: VerificationStatus | "",
): Promise<AdminApplicationsResponse> {
  const query = search.trim().toLowerCase();
  const applications = (await getApplicationRows())
    .map(rowToApplication)
    .filter((application) =>
      (!query || application.applicantName.toLowerCase().includes(query) || application.email.toLowerCase().includes(query)) &&
      (!status || application.status === status) &&
      (!verification || application.verificationStatus === verification),
    );
  return { applications, total: applications.length };
}

export async function getAdminApplicationDetails(id: string) {
  const { data, error } = await supabase
    .from("applications")
    .select(applicationFields)
    .eq("submission_id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Application not found.");
  return rowToApplication(data as ApplicationRow);
}

export async function deleteAdminApplication(id: string) {
  const result = await apiRequest<{ id: string }>(`/api/admin/applications/${encodeURIComponent(id)}`, { method: "DELETE" });
  notifyAdminReviewCountsChanged();
  return result;
}

export async function updateAdminApplicationStatus(id: string, status: AdminApplicationStatus) {
  const result = await apiRequest<{ id: string; status: AdminApplicationStatus }>(`/api/admin/applications/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  notifyAdminReviewCountsChanged();
  return result;
}

export async function updateAdminApplicationVerification(id: string, verificationStatus: VerificationStatus) {
  const { data, error } = await supabase
    .from("applications")
    .update({ verification_status: verificationStatus })
    .eq("submission_id", id)
    .select("submission_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Application not found.");
  return { id, verificationStatus };
}
