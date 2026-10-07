import type { RequestHandler } from "express";
import { z } from "zod";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";

const detailsSchema = z.object({
  payeeName: z.string().trim().min(1).max(160),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200),
  city: z.string().trim().min(1).max(100),
  stateProvince: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(24),
  country: z.string().trim().min(1).max(100),
}).strict();

async function authorize(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], admin = false) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }
  const isAdmin = data.user.app_metadata?.role === "admin";
  if (admin && !isAdmin) {
    res.status(403).json({ error: "Administrator access required." });
    return null;
  }
  return { user: data.user, isAdmin };
}

function serviceClient(res: Parameters<RequestHandler>[1]) {
  try {
    return createServiceRoleSupabaseClient();
  } catch {
    res.status(503).json({ error: "Check payment details are unavailable." });
    return null;
  }
}

function validRequestId(value: string | string[]) {
  return z.string().uuid().safeParse(value).success;
}

export const getMyBankingDetailsStatus: RequestHandler = async (req, res) => {
  const auth = await authorize(req, res);
  if (!auth) return;
  if (!validRequestId(req.params.id)) {
    res.status(400).json({ error: "Invalid payment request." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: request, error: requestError } = await service
    .from("payment_requests")
    .select("id, user_id, status")
    .eq("id", req.params.id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (requestError || !request) {
    res.status(404).json({ error: "Payment request not found." });
    return;
  }
  if (request.status !== "Approved") {
    res.status(403).json({ error: "Check payment details are available after device approval." });
    return;
  }
  const { data, error } = await service
    .from("device_check_payment_details")
    .select("submitted_at")
    .eq("payment_request_id", request.id)
    .maybeSingle();
  if (error) {
    res.status(503).json({ error: "Unable to load check payment status." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ submitted: Boolean(data), submittedAt: data?.submitted_at ?? null });
};

export const submitBankingDetails: RequestHandler = async (req, res) => {
  const auth = await authorize(req, res);
  if (!auth) return;
  if (!validRequestId(req.params.id)) {
    res.status(400).json({ error: "Invalid payment request." });
    return;
  }
  const parsed = detailsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Complete all required check payment fields." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: request, error: requestError } = await service
    .from("payment_requests")
    .select("id, user_id, status")
    .eq("id", req.params.id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (requestError || !request) {
    res.status(404).json({ error: "Payment request not found." });
    return;
  }
  if (request.status !== "Approved") {
    res.status(403).json({ error: "Check payment details can only be submitted after device approval." });
    return;
  }
  const submittedAt = new Date().toISOString();
  const { data, error } = await service
    .from("device_check_payment_details")
    .insert({
      payment_request_id: request.id,
      user_id: auth.user.id,
      payee_name: parsed.data.payeeName,
      address_line_1: parsed.data.addressLine1,
      address_line_2: parsed.data.addressLine2 || null,
      city: parsed.data.city,
      state_province: parsed.data.stateProvince,
      postal_code: parsed.data.postalCode,
      country: parsed.data.country,
      submitted_at: submittedAt,
    })
    .select("submitted_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: "Check payment details have already been submitted." });
      return;
    }
    res.status(500).json({ error: "Unable to save check payment details." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json({ submitted: true, submittedAt: data.submitted_at });
};

export const getAdminBankingDetails: RequestHandler = async (req, res) => {
  const auth = await authorize(req, res, true);
  if (!auth) return;
  if (!validRequestId(req.params.id)) {
    res.status(400).json({ error: "Invalid payment request." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: request, error: requestError } = await service
    .from("payment_requests")
    .select("id, user_id, status")
    .eq("id", req.params.id)
    .maybeSingle();
  if (requestError || !request) {
    res.status(404).json({ error: "Payment request not found." });
    return;
  }
  const [{ data: details, error: detailsError }, { data: kyc, error: kycError }] = await Promise.all([
    service
      .from("device_check_payment_details")
      .select("payee_name, address_line_1, address_line_2, city, state_province, postal_code, country, submitted_at")
      .eq("payment_request_id", request.id)
      .maybeSingle(),
    service
      .from("contributor_kyc_submissions")
      .select("status")
      .eq("user_id", request.user_id)
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (detailsError || kycError) {
    res.status(503).json({ error: "Unable to load payment review details." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({
    paymentStatus: request.status,
    kycStatus: kyc?.status ?? "Not submitted",
    deviceApprovalStatus: request.status === "Approved" ? "Approved" : request.status,
    submitted: Boolean(details),
    submittedAt: details?.submitted_at ?? null,
    bankingDetails: details ? {
      payeeName: details.payee_name,
      addressLine1: details.address_line_1,
      addressLine2: details.address_line_2 ?? "",
      city: details.city,
      stateProvince: details.state_province,
      postalCode: details.postal_code,
      country: details.country,
    } : null,
  });
};
