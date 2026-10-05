import type { Request, RequestHandler } from "express";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";
import { notifyAdmins, notifyUser } from "../lib/notifications";
import type { AdminApplication, AdminApplicationStatus, VerificationStatus } from "../../shared/admin-applications";

const allowedStatuses: AdminApplicationStatus[] = ["Under Review", "Approved", "Rejected"];
const allowedVerificationStatuses: VerificationStatus[] = ["Verified", "Not Verified"];

const eligibilityLabels = [
  "I am at least 18 years old.",
  "I have reliable internet access.",
  "I can follow assignment instructions accurately.",
  "I agree to Contributor Program policies.",
  "I understand applications are reviewed before approval.",
];

type ApplicationInput = Record<string, unknown>;

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

async function getAdminUser(req: Request, res: Parameters<RequestHandler>[1]) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (data.user.app_metadata?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return null;
  }
  return data.user;
}

function serviceClient(res: Parameters<RequestHandler>[1]) {
  try {
    return createServiceRoleSupabaseClient();
  } catch {
    res.status(503).json({ error: "Admin application data is not configured." });
    return null;
  }
}

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
  const details = {
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
  };
  return {
    id: row.submission_id,
    applicantName: `${row.first_name} ${row.last_name}`.trim() || "Unnamed applicant",
    email: row.email,
    phone: row.phone,
    country: row.country,
    applicationDate: row.created_at,
    status: row.status,
    verificationStatus: row.verification_status,
    details,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const recentSubmissions = new Map<string, number[]>();

function textField(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Best-effort per-instance throttle (serverless instances do not share memory). */
function isRateLimited(ip: string) {
  const now = Date.now();
  const hits = (recentSubmissions.get(ip) ?? []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  recentSubmissions.set(ip, hits);
  return hits.length > RATE_LIMIT_MAX;
}

export const mirrorApplication: RequestHandler = async (req, res) => {
  const body = (req.body ?? {}) as ApplicationInput;
  // Honeypot: real users never fill this hidden field.
  if (textField(body.website, 200)) {
    res.status(400).json({ error: "Unable to save the application." });
    return;
  }
  const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "unknown").trim();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many submissions. Please wait a few minutes and try again." });
    return;
  }

  const firstName = textField(body.firstName, 100);
  const lastName = textField(body.lastName, 100);
  const email = textField(body.email, 254).toLowerCase();
  const phone = textField(body.phone, 40);
  const country = textField(body.country, 100);
  const timeZone = textField(body.timeZone, 100);
  const hours = textField(body.hours, 50);
  const experience = textField(body.experience, 2000);
  const reason = textField(body.reason, 5000);
  const interests = Array.isArray(body.interests) ? body.interests.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 100)) : [];
  const eligibility = Array.isArray(body.eligibility) ? body.eligibility.filter((item): item is string => typeof item === "string") : [];

  if (!firstName || !lastName || !email || !phone || !country || !timeZone) {
    res.status(400).json({ error: "Please complete all required personal information fields." });
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }
  if (!interests.length) {
    res.status(400).json({ error: "Please select at least one assignment category." });
    return;
  }
  if (!eligibilityLabels.every((label) => eligibility.includes(label))) {
    res.status(400).json({ error: "Please confirm all eligibility statements." });
    return;
  }

  const serviceSupabase = serviceClient(res);
  if (!serviceSupabase) return;

  const { data: pending, error: duplicateError } = await serviceSupabase
    .from("applications")
    .select("submission_id")
    .ilike("email", email)
    .eq("status", "Under Review")
    .limit(1);
  if (duplicateError) {
    console.error("[api] Unable to check for duplicate applications.", duplicateError);
    res.status(500).json({ error: "Unable to save the application." });
    return;
  }
  if (pending?.length) {
    res.status(409).json({ error: "An application for this email address is already under review." });
    return;
  }

  const authToken = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  let applicantId: string | null = null;
  if (authToken) {
    const { data: auth, error: authError } = await supabase.auth.getUser(authToken);
    if (authError || !auth.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    applicantId = auth.user.id;
  }

  let referralOwnerId: string | null = null;
  const submittedCode = textField(body.referralCode, 32).toUpperCase();
  if (submittedCode) {
    const { data: matchedCode, error: referralError } = await serviceSupabase.from("contributor_referral_codes").select("user_id").eq("code", submittedCode).maybeSingle();
    if (referralError) {
      console.error("[api] Unable to validate referral code.", referralError);
      res.status(500).json({ error: "Unable to save the application." });
      return;
    }
    if (!matchedCode) {
      res.status(400).json({ error: "The referral code is not valid." });
      return;
    }
    referralOwnerId = matchedCode.user_id;
  }
  const { data: previousApplications, error: previousError } = await serviceSupabase.from("applications").select("referral_owner_user_id").ilike("email", email).not("referral_owner_user_id", "is", null).order("created_at", { ascending: true }).limit(1);
  if (previousError) {
    console.error("[api] Unable to check referral attribution.", previousError);
    res.status(500).json({ error: "Unable to save the application." });
    return;
  }
  if (previousApplications?.[0]?.referral_owner_user_id) referralOwnerId = previousApplications[0].referral_owner_user_id;
  if (referralOwnerId) {
    const { data: referralOwner, error: ownerError } = await serviceSupabase.auth.admin.getUserById(referralOwnerId);
    if (ownerError) {
      console.error("[api] Unable to verify referral owner.", ownerError);
      res.status(500).json({ error: "Unable to save the application." });
      return;
    }
    if (applicantId === referralOwnerId || referralOwner.user?.email?.toLowerCase() === email) referralOwnerId = null;
  }

  const applicationId = crypto.randomUUID();
  const applicationValues = {
    referral_owner_user_id: referralOwnerId,
    id: applicationId,
    submission_id: applicationId,
    status: "Under Review",
    verification_status: "Not Verified",
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    country,
    time_zone: timeZone,
    assignment_categories: interests,
    weekly_hours: hours,
    previous_experience: experience,
    motivation: reason,
    age_18_plus: eligibility.includes(eligibilityLabels[0]),
    reliable_internet: eligibility.includes(eligibilityLabels[1]),
    follows_instructions: eligibility.includes(eligibilityLabels[2]),
    agrees_policies: eligibility.includes(eligibilityLabels[3]),
    understands_review: eligibility.includes(eligibilityLabels[4]),
  };
  const { error } = await serviceSupabase.from("applications").insert(applicationValues);

  if (error) {
    console.error("[api] Unable to save the application.", applicationId, error);
    res.status(500).json({ error: "Unable to save the application." });
    return;
  }
  await notifyAdmins({
    type: "new_application",
    title: "New Application Submitted",
    message: `${firstName} ${lastName} submitted a new contributor application.`,
    link: "/admin/applications",
    relatedId: applicationId,
  });
  res.status(201).json({ id: applicationId });
};

/** The signed-in user's latest application (matched by linked user id or account email). */
export const getMyApplication: RequestHandler = async (req, res) => {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const serviceSupabase = serviceClient(res);
  if (!serviceSupabase) return;
  const { data: interview, error: interviewError } = await serviceSupabase.from("interview_submissions")
    .select("id, status, submitted_at")
    .eq("user_id", auth.user.id)
    .not("submitted_at", "is", null)
    .maybeSingle();
  if (interviewError) {
    res.status(500).json({ error: "Unable to load your interview status." });
    return;
  }
  if (interview) {
    res.json({ application: { id: interview.id, status: interview.status, verificationStatus: "Not Verified", submittedAt: interview.submitted_at } });
    return;
  }
  const email = (auth.user.email ?? "").toLowerCase();
  if (!email) {
    res.json({ application: null });
    return;
  }
  const { data, error } = await serviceSupabase
    .from("applications")
    .select("submission_id, status, verification_status, created_at")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[api] Unable to load your application.", error);
    res.status(500).json({ error: "Unable to load your application." });
    return;
  }
  res.json({
    application: data
      ? { id: data.submission_id, status: data.status, verificationStatus: data.verification_status, submittedAt: data.created_at }
      : null,
  });
};

const selectColumns = "id, submission_id, created_at, status, verification_status, first_name, last_name, email, phone, country, time_zone, assignment_categories, weekly_hours, previous_experience, motivation, age_18_plus, reliable_internet, follows_instructions, agrees_policies, understands_review";

async function listRows(req: Request, res: Parameters<RequestHandler>[1]) {
  const serviceSupabase = serviceClient(res);
  if (!serviceSupabase) return null;
  const { data, error } = await serviceSupabase.from("applications").select(selectColumns).order("created_at", { ascending: false });
  if (error) {
    console.error("[api] Unable to load applications.", error);
    res.status(500).json({ error: "Unable to load applications." });
    return null;
  }

  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  return (data as ApplicationRow[]).map(rowToApplication).filter((application) =>
    (!search || application.applicantName.toLowerCase().includes(search) || application.email.toLowerCase().includes(search)) &&
    (!status || application.status === status),
  );
}

export const listAdminApplications: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const applications = await listRows(req, res);
  if (!applications) return;
  res.json({ applications, total: applications.length });
};

export const getAdminApplicationDetails: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const applications = await listRows(req, res);
  if (!applications) return;
  const application = applications.find((item) => item.id === req.params.id);
  if (!application) {
    res.status(404).json({ error: "Application not found." });
    return;
  }
  res.json(application);
};

export const deleteAdminApplication: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const serviceSupabase = serviceClient(res);
  if (!serviceSupabase) return;
  const { data, error } = await serviceSupabase
    .from("applications")
    .delete()
    .eq("submission_id", req.params.id)
    .select("submission_id")
    .maybeSingle();
  if (error) {
    console.error("[api] Unable to delete application.", error);
    res.status(500).json({ error: "Unable to delete application." });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Application not found." });
    return;
  }
  res.json({ id: data.submission_id });
};

export const updateAdminApplicationStatus: RequestHandler = async (req, res) => {
  const admin = await getAdminUser(req, res);
  if (!admin) return;
  const serviceSupabase = serviceClient(res);
  if (!serviceSupabase) return;
  const status = req.body?.status as AdminApplicationStatus;
  if (!allowedStatuses.includes(status)) {
    res.status(400).json({ error: "Invalid application status." });
    return;
  }
  const { data: application, error } = await serviceSupabase
    .from("applications")
    .update({ status })
    .eq("submission_id", req.params.id)
    .select("id, submission_id, first_name, last_name, email, referral_owner_user_id")
    .maybeSingle();
  if (error) {
    console.error("[api] Unable to update application status.", error);
    res.status(500).json({ error: "Unable to update application status." });
    return;
  }
  if (!application) {
    res.status(404).json({ error: "Application not found." });
    return;
  }

  let userId: string | null = null;
  if (application.email) {
    let page = 1;
    while (!userId) {
      const { data, error: usersError } = await serviceSupabase.auth.admin.listUsers({ page, perPage: 100 });
      if (usersError || data.users.length === 0) break;
      const users = data.users as unknown as Array<{ id: string; email?: string | null }>;
      userId = users.find((candidate) => candidate.email?.toLowerCase() === application.email.toLowerCase())?.id ?? null;
      if (data.users.length < 100) break;
      page++;
    }
  }

  if (userId) {
    const referralStatus = status === "Approved" ? "Successful" : status === "Rejected" ? "Rejected" : "Pending";
    const { error: referralError } = await serviceSupabase.rpc("qualify_contributor_referral", {
      target_referred_user_id: userId,
      target_referrer_user_id: application.referral_owner_user_id,
      qualification_status: referralStatus,
      acting_admin_id: admin.id,
    });
    if (referralError) {
      console.error("[api] Unable to qualify referral.", referralError);
      res.status(500).json({ error: "Unable to record referral qualification." });
      return;
    }
  }

  if (userId && (status === "Approved" || status === "Rejected")) {
    const applicantName = `${application.first_name} ${application.last_name}`.trim() || "Your application";
    await notifyUser({
      userId,
      type: status === "Approved" ? "application_approved" : "application_rejected",
      title: `Contributor Application ${status}`,
      message: `${applicantName} has been ${status.toLowerCase()}.`,
      link: "/dashboard",
      relatedId: application.id,
    });
  }

  res.json({ id: req.params.id, status });
};

export const updateAdminApplicationVerification: RequestHandler = async (req, res) => {
  if (!(await getAdminUser(req, res))) return;
  const serviceSupabase = serviceClient(res);
  if (!serviceSupabase) return;
  const verificationStatus = req.body?.verificationStatus as VerificationStatus;
  if (!allowedVerificationStatuses.includes(verificationStatus)) {
    res.status(400).json({ error: "Invalid verification status." });
    return;
  }
  const { error } = await serviceSupabase.from("applications").update({ verification_status: verificationStatus }).eq("submission_id", req.params.id);
  if (error) {
    console.error("[api] Unable to update verification status.", error);
    res.status(500).json({ error: "Unable to update verification status." });
    return;
  }
  res.json({ id: req.params.id, verificationStatus });
};
