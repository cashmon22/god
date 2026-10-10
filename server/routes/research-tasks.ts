import type { RequestHandler } from "express";
import { z } from "zod";
import type { ProductResearchDraft } from "../../shared/product-research";
import { PRODUCT_RESEARCH_TEMPLATE } from "../../shared/product-research";
import { assignments } from "../../client/lib/assignments";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";

const taskColumns = "id, user_id, assignment_id, status, created_at, template_id, template_version, product_name, draft, progress, current_step, accepted_at, last_activity_at, submitted_at, reviewed_at, change_request, reward_min, reward_max";
const text = z.string().max(12000);
const url = z.string().max(2000).refine((value) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}, "Use a valid http or https URL.");
const evidenceSchema = z.array(z.object({
  sourceUrl: url,
  notes: z.string().max(4000),
  filePath: z.string().max(500).optional(),
  fileName: z.string().max(255).optional(),
  mimeType: z.string().max(100).optional(),
})).max(10);
const draftSchema = z.object({
  productInformation: z.object({ productName: text, sourceUrl: url, category: text, price: text, rating: text, otherInformation: text, evidence: evidenceSchema }),
  productFeatures: z.object({ mainFeatures: text, benefits: text, strengths: text, weaknesses: text, observations: text, evidence: evidenceSchema }),
  competitorResearch: z.object({ competitors: z.array(z.object({ name: text, productUrl: url, price: text, keyFeatures: text, advantages: text, disadvantages: text, notes: text })).max(20), evidence: evidenceSchema }),
  customerResearch: z.object({ positiveThemes: text, negativeThemes: text, complaints: text, praises: text, observations: text, evidence: evidenceSchema }),
  marketTrends: z.object({ trends: text, patterns: text, opportunities: text, risks: text, evidence: evidenceSchema }),
  finalAnalysis: z.object({ keyFindings: text, overallAssessment: text, recommendations: text, additionalNotes: text, evidence: evidenceSchema }),
});

async function getUser(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], requireAdmin = false) {
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
  if (requireAdmin && data.user.app_metadata?.role !== "admin") {
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

export function calculateResearchProgress(draft: ProductResearchDraft) {
  const filled = (value: string) => value.trim().length > 0;
  const complete = [
    filled(draft.productInformation.productName) && filled(draft.productInformation.sourceUrl) && filled(draft.productInformation.category) && filled(draft.productInformation.price),
    filled(draft.productFeatures.mainFeatures) && filled(draft.productFeatures.benefits) && filled(draft.productFeatures.strengths) && filled(draft.productFeatures.weaknesses),
    draft.competitorResearch.competitors.some((entry) => filled(entry.name) && filled(entry.productUrl) && filled(entry.keyFeatures)),
    filled(draft.customerResearch.positiveThemes) && filled(draft.customerResearch.negativeThemes) && filled(draft.customerResearch.complaints) && filled(draft.customerResearch.praises),
    filled(draft.marketTrends.trends) && filled(draft.marketTrends.patterns) && filled(draft.marketTrends.opportunities) && filled(draft.marketTrends.risks),
    filled(draft.finalAnalysis.keyFindings) && filled(draft.finalAnalysis.overallAssessment) && filled(draft.finalAnalysis.recommendations),
  ];
  return { completedSections: complete.filter(Boolean).length, progress: Math.round(complete.filter(Boolean).length / 7 * 100), complete };
}

function toTask(row: Record<string, any>) {
  const assignment = assignments.find((item) => item.id === row.assignment_id);
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    status: row.status,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    lastActivityAt: row.last_activity_at,
    submittedAt: row.submitted_at,
    productName: row.product_name,
    progress: row.progress ?? 0,
    currentStep: row.current_step ?? "product-information",
    changeRequest: row.change_request,
    rewardMin: row.reward_min,
    rewardMax: row.reward_max,
    templateId: row.template_id,
    templateVersion: row.template_version,
    draft: row.draft,
    assignment: assignment ? {
      title: assignment.category === "Product Research" ? PRODUCT_RESEARCH_TEMPLATE.title : assignment.title,
      category: assignment.category,
      description: assignment.description,
      estimatedTime: assignment.category === "Product Research" ? PRODUCT_RESEARCH_TEMPLATE.estimatedTime : assignment.estimatedTime,
      reward: assignment.reward,
    } : { title: "Product Research", category: "Product Research", description: "Research the assigned product and record sourced findings.", estimatedTime: PRODUCT_RESEARCH_TEMPLATE.estimatedTime, reward: 0 },
  };
}

function emptyToNull(value: string | null | undefined) {
  return value?.trim() || null;
}

export const listContributorResearchTasks: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await service.from("contributor_tasks").select(taskColumns).eq("user_id", user.id).eq("template_id", PRODUCT_RESEARCH_TEMPLATE.id).order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: "Unable to load Product Research assignments." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ tasks: (data ?? []).map(toTask) });
};

export const acceptResearchTask: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const taskId = typeof req.params.id === "string" ? req.params.id : "";
  const service = serviceClient(res);
  if (!service) return;
  const { data: approvedDevice, error: deviceError } = await service.from("payment_requests").select("id").eq("user_id", user.id).eq("status", "Approved").limit(1).maybeSingle();
  if (deviceError) {
    res.status(500).json({ error: "Unable to verify this device." });
    return;
  }
  if (!approvedDevice) {
    res.status(403).json({ error: "Verify your device before accepting this assignment." });
    return;
  }
  const { data, error } = await service.from("contributor_tasks").update({ status: "Accepted", accepted_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", user.id).eq("status", "Available").select(taskColumns).maybeSingle();
  if (error) {
    res.status(500).json({ error: "Unable to accept this assignment." });
    return;
  }
  if (!data) {
    res.status(409).json({ error: "This assignment is no longer available." });
    return;
  }
  res.json(toTask(data));
};

export const getContributorResearchTask: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const taskId = typeof req.params.id === "string" ? req.params.id : "";
  const service = serviceClient(res);
  if (!service) return;
  const { data, error } = await service.from("contributor_tasks").select(taskColumns).eq("id", taskId).eq("user_id", user.id).eq("template_id", PRODUCT_RESEARCH_TEMPLATE.id).maybeSingle();
  if (error || !data) {
    res.status(error ? 500 : 404).json({ error: error ? "Unable to load this assignment." : "Assignment not found." });
    return;
  }
  if (data.status === "Accepted") {
    const { data: updated, error: updateError } = await service.from("contributor_tasks").update({ status: "In Progress", last_activity_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", user.id).eq("status", "Accepted").select(taskColumns).maybeSingle();
    if (!updateError && updated) Object.assign(data, updated);
  }
  if (["Submitted", "Under Review", "Completed"].includes(data.status)) {
    const { data: submission, error: submissionError } = await service.from("contributor_task_submissions").select("snapshot").eq("task_id", taskId).order("revision", { ascending: false }).limit(1).maybeSingle();
    if (submissionError) {
      res.status(500).json({ error: "Unable to load the submitted version." });
      return;
    }
    if (submission?.snapshot && typeof submission.snapshot === "object" && "draft" in submission.snapshot) {
      data.draft = (submission.snapshot as { draft: ProductResearchDraft }).draft;
    }
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(toTask(data));
};

export const saveContributorResearchTask: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const parsed = draftSchema.safeParse(req.body?.draft);
  const currentStep = z.string().max(80).safeParse(req.body?.currentStep);
  if (!parsed.success || !currentStep.success || !PRODUCT_RESEARCH_TEMPLATE.sections.some((section) => section.id === currentStep.data)) {
    res.status(400).json({ error: "The assignment draft is invalid." });
    return;
  }
  const taskId = typeof req.params.id === "string" ? req.params.id : "";
  const filePaths = Object.values(parsed.data).flatMap((section: any) => section.evidence.flatMap((evidence: any) => evidence.filePath ? [evidence.filePath] : []));
  if (filePaths.some((path) => !path.startsWith(`${taskId}/`))) {
    res.status(400).json({ error: "Evidence must belong to this assignment." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: task, error: taskError } = await service.from("contributor_tasks").select("status").eq("id", taskId).eq("user_id", user.id).eq("template_id", PRODUCT_RESEARCH_TEMPLATE.id).maybeSingle();
  if (taskError || !task) {
    res.status(taskError ? 500 : 404).json({ error: taskError ? "Unable to save your progress." : "Assignment not found." });
    return;
  }
  if (!["Accepted", "In Progress", "Changes Requested", "Started"].includes(task.status)) {
    res.status(409).json({ error: "This submitted assignment is locked." });
    return;
  }
  const calculated = calculateResearchProgress(parsed.data as ProductResearchDraft);
  const nextStatus = task.status === "Accepted" || task.status === "Started" ? "In Progress" : task.status;
  const { data, error } = await service.from("contributor_tasks").update({ draft: parsed.data, status: nextStatus, current_step: currentStep.data, progress: calculated.progress, last_activity_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", user.id).in("status", ["Accepted", "In Progress", "Changes Requested", "Started"]).select(taskColumns).maybeSingle();
  if (error) {
    res.status(500).json({ error: "Unable to save your progress." });
    return;
  }
  if (!data) {
    res.status(409).json({ error: "This submitted assignment is locked." });
    return;
  }
  res.json(toTask(data));
};

export const submitContributorResearchTask: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const parsed = draftSchema.safeParse(req.body?.draft);
  if (!parsed.success) {
    res.status(400).json({ error: "Review and complete all required fields before submitting." });
    return;
  }
  const taskId = typeof req.params.id === "string" ? req.params.id : "";
  const filePaths = Object.values(parsed.data).flatMap((section: any) => section.evidence.flatMap((evidence: any) => evidence.filePath ? [evidence.filePath] : []));
  if (filePaths.some((path) => !path.startsWith(`${taskId}/`))) {
    res.status(400).json({ error: "Evidence must belong to this assignment." });
    return;
  }
  const completion = calculateResearchProgress(parsed.data as ProductResearchDraft);
  if (completion.completedSections !== 6) {
    res.status(400).json({ error: "Complete each required research section before submitting." });
    return;
  }
  const service = serviceClient(res);
  if (!service) return;
  const { data: task, error: taskError } = await service.from("contributor_tasks").select(taskColumns).eq("id", taskId).eq("user_id", user.id).eq("template_id", PRODUCT_RESEARCH_TEMPLATE.id).maybeSingle();
  if (taskError || !task) {
    res.status(taskError ? 500 : 404).json({ error: taskError ? "Unable to submit this assignment." : "Assignment not found." });
    return;
  }
  const snapshot = { template: PRODUCT_RESEARCH_TEMPLATE, productName: task.product_name, draft: parsed.data, progress: 100 };
  const { data: submissionId, error } = await service.rpc("submit_contributor_task", { p_task_id: taskId, p_user_id: user.id, p_snapshot: snapshot });
  if (error) {
    res.status(409).json({ error: "This assignment can no longer be submitted." });
    return;
  }
  const { data: savedTask } = await service.from("contributor_tasks").select(taskColumns).eq("id", taskId).eq("user_id", user.id).single();
  res.json({ ...(savedTask ? toTask(savedTask) : toTask({ ...task, status: "Submitted", progress: 100 })), submissionId });
};
