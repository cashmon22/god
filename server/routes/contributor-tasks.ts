import type { RequestHandler } from "express";
import { z } from "zod";
import { assignments } from "../../client/lib/assignments";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";

const taskInputSchema = z.object({ assignmentId: z.string().min(1) });
const taskColumns = "id, assignment_id, status, created_at";

async function getUser(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
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
  return data.user;
}

function serviceClient(res: Parameters<RequestHandler>[1]) {
  try {
    return createServiceRoleSupabaseClient();
  } catch {
    res.status(503).json({ error: "Task data is not configured." });
    return null;
  }
}

function toTask(row: { id: string; assignment_id: string; status: string; created_at: string }) {
  const assignment = assignments.find((item) => item.id === row.assignment_id);
  return assignment ? {
    id: row.id,
    assignmentId: row.assignment_id,
    status: row.status,
    createdAt: row.created_at,
    assignment,
  } : null;
}

export const listContributorTasks: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const serviceSupabase = serviceClient(res);
  if (!serviceSupabase) return;

  const { data, error } = await serviceSupabase
    .from("contributor_tasks")
    .select(taskColumns)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: "Unable to load your tasks." });
    return;
  }

  res.json({ tasks: (data ?? []).map(toTask).filter((task) => task !== null) });
};

export const startContributorTask: RequestHandler = async (req, res) => {
  const user = await getUser(req, res);
  if (!user) return;
  const parsed = taskInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid assignment is required." });
    return;
  }
  const assignment = assignments.find((item) => item.id === parsed.data.assignmentId);
  if (!assignment || assignment.status === "Full") {
    res.status(409).json({ error: "This assignment is not currently available." });
    return;
  }
  const serviceSupabase = serviceClient(res);
  if (!serviceSupabase) return;

  const { data: approvedDevice, error: deviceError } = await serviceSupabase
    .from("payment_requests")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "Approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (deviceError) {
    res.status(500).json({ error: "Unable to verify this device." });
    return;
  }
  if (!approvedDevice) {
    res.status(403).json({ error: "Verify your device before starting this task." });
    return;
  }

  const productResearch = assignment.category === "Product Research";
  const { data, error } = await serviceSupabase
    .from("contributor_tasks")
    .insert({
      user_id: user.id,
      assignment_id: assignment.id,
      ...(productResearch ? {
        status: "In Progress",
        template_id: "product-research",
        template_version: 1,
        reward_min: 20,
        reward_max: 100,
        current_step: "product-information",
      } : {}),
    })
    .select(taskColumns)
    .single();
  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: "You have already started this assignment." });
      return;
    }
    res.status(500).json({ error: "Unable to start this assignment." });
    return;
  }

  res.status(201).json(toTask(data));
};
