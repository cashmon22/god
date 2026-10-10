import type { RequestHandler } from "express";
import { z } from "zod";
import { PRODUCT_RESEARCH_TEMPLATE } from "../../shared/product-research";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";

const taskColumns = "id, user_id, assignment_id, status, created_at, template_id, template_version, product_name, draft, progress, current_step, accepted_at, last_activity_at, submitted_at, reviewed_at, change_request, reward_min, reward_max";
const createSchema = z.object({ userId: z.string().uuid(), productName: z.string().trim().min(1).max(200) });
const reviewSchema = z.object({ decision: z.enum(["Approved", "Changes Requested"]), message: z.string().trim().max(4000).optional() }).superRefine((value, ctx) => {
  if (value.decision === "Changes Requested" && !value.message) ctx.addIssue({ code: "custom", message: "A reason is required." });
});

async function getAdmin(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
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
    res.status(503).json({ error: "Assignment data is not configured." });
    return null;
  }
}

async function contributorName(service: ReturnType<typeof createServiceRoleSupabaseClient>, id: string) {
  const { data } = await service.auth.admin.getUserById(id);
  const metadata = data.user?.user_metadata;
  return typeof metadata?.full_name === "string" && metadata.full_name.trim() || typeof metadata?.name === "string" && metadata.name.trim() || "Contributor";
}

export const listAdminResearchTasks: RequestHandler = async (req, res) => {
  if (!await getAdmin(req, res)) return;
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await service.from("contributor_tasks").select(taskColumns).eq("template_id", PRODUCT_RESEARCH_TEMPLATE.id).order("last_activity_at", { ascending: false }).limit(250);
  if (error) {
    res.status(500).json({ error: "Unable to load Product Research assignments." });
    return;
  }
  const names = new Map<string, string>();
  await Promise.all([...new Set((data ?? []).map((task) => task.user_id))].map(async (id) => names.set(id, await contributorName(service, id))));
  res.setHeader("Cache-Control", "no-store");
  res.json({ tasks: (data ?? []).map((task) => ({
    id: task.id,
    contributor: names.get(task.user_id) ?? "Contributor",
    status: task.status,
    productName: task.product_name,
    progress: task.progress ?? 0,
    currentStep: task.current_step,
    startedAt: task.accepted_at ?? task.created_at,
    lastActivityAt: task.last_activity_at,
    submittedAt: task.submitted_at,
    rewardMin: task.reward_min,
    rewardMax: task.reward_max,
  })) });
};

export const createAdminResearchTask: RequestHandler = async (req, res) => {
  const admin = await getAdmin(req, res);
  if (!admin) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select a contributor and enter the assigned product name." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: contributor, error: contributorError } = await service.auth.admin.getUserById(parsed.data.userId);
  if (contributorError || !contributor.user || contributor.user.app_metadata?.role === "admin") {
    res.status(404).json({ error: "Contributor not found." });
    return;
  }
  const { data, error } = await service.from("contributor_tasks").insert({
    user_id: contributor.user.id,
    assignment_id: "asg-001",
    status: "Available",
    assigned_by: admin.id,
    template_id: PRODUCT_RESEARCH_TEMPLATE.id,
    template_version: PRODUCT_RESEARCH_TEMPLATE.version,
    product_name: parsed.data.productName,
    draft: {},
    progress: 0,
    current_step: "product-information",
    reward_min: PRODUCT_RESEARCH_TEMPLATE.rewardMin,
    reward_max: PRODUCT_RESEARCH_TEMPLATE.rewardMax,
    last_activity_at: new Date().toISOString(),
  }).select(taskColumns).single();
  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: "This contributor already has an active Product Research assignment." });
      return;
    }
    res.status(500).json({ error: "Unable to assign Product Research." });
    return;
  }
  res.status(201).json({ id: data.id, contributor: await contributorName(service, data.user_id), status: data.status, productName: data.product_name, progress: data.progress, currentStep: data.current_step, startedAt: data.created_at, lastActivityAt: data.last_activity_at, submittedAt: data.submitted_at, rewardMin: data.reward_min, rewardMax: data.reward_max });
};

export const getAdminResearchTask: RequestHandler = async (req, res) => {
  if (!await getAdmin(req, res)) return;
  const service = serviceClient(res);
  if (!service) return;
  const taskId = typeof req.params.id === "string" ? req.params.id : "";
  const { data: task, error } = await service.from("contributor_tasks").select(taskColumns).eq("id", taskId).eq("template_id", PRODUCT_RESEARCH_TEMPLATE.id).maybeSingle();
  if (error || !task) {
    res.status(error ? 500 : 404).json({ error: error ? "Unable to load this assignment." : "Assignment not found." });
    return;
  }
  if (task.status === "Submitted") {
    await service.from("contributor_tasks").update({ status: "Under Review", last_activity_at: new Date().toISOString() }).eq("id", taskId).eq("status", "Submitted");
    task.status = "Under Review";
  }
  const { data: submission, error: submissionError } = await service.from("contributor_task_submissions").select("id, revision, template_id, template_version, snapshot, submitted_at").eq("task_id", taskId).order("revision", { ascending: false }).limit(1).maybeSingle();
  if (submissionError) {
    res.status(500).json({ error: "Unable to load the submission." });
    return;
  }
  const snapshot = submission?.snapshot as Record<string, any> | undefined;
  const draft = snapshot?.draft;
  if (draft) {
    for (const section of Object.values(draft) as Array<{ evidence?: Array<{ filePath?: string }> }>) {
      for (const evidence of section.evidence ?? []) {
        if (!evidence.filePath) continue;
        const { data: signed } = await service.storage.from("assignment-evidence").createSignedUrl(evidence.filePath, 3600);
        if (signed) Object.assign(evidence, { fileUrl: signed.signedUrl });
      }
    }
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ id: task.id, contributor: await contributorName(service, task.user_id), productName: task.product_name, status: task.status, progress: task.progress, currentStep: task.current_step, submittedAt: submission?.submitted_at ?? task.submitted_at, changeRequest: task.change_request, rewardMin: task.reward_min, rewardMax: task.reward_max, submission: submission ? { id: submission.id, revision: submission.revision, snapshot } : null });
};

export const reviewAdminResearchTask: RequestHandler = async (req, res) => {
  const admin = await getAdmin(req, res);
  if (!admin) return;
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A reason is required when requesting changes." });
    return;
  }
  const taskId = typeof req.params.id === "string" ? req.params.id : "";
  const service = serviceClient(res);
  if (!service) return;
  const { data: task, error: taskError } = await service.from("contributor_tasks").select("id, status").eq("id", taskId).eq("template_id", PRODUCT_RESEARCH_TEMPLATE.id).maybeSingle();
  if (taskError || !task) {
    res.status(taskError ? 500 : 404).json({ error: taskError ? "Unable to review this assignment." : "Assignment not found." });
    return;
  }
  const { error } = await service.rpc("review_contributor_task", { p_task_id: taskId, p_admin_id: admin.id, p_decision: parsed.data.decision, p_message: parsed.data.message ?? null });
  if (error) {
    res.status(409).json({ error: "This assignment is no longer awaiting review." });
    return;
  }
  res.json({ id: task.id, status: parsed.data.decision === "Approved" ? "Completed" : "Changes Requested" });
};
