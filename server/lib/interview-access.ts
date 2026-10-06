import type { RequestHandler } from "express";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient, supabase } from "./supabase";

export async function getInterviewStatus(user: Pick<User, "id">) {
  const service = createServiceRoleSupabaseClient();
  const { data: interview, error } = await service.from("interview_submissions").select("status").eq("user_id", user.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return interview?.status as "Under Review" | "Approved" | "Rejected" | undefined ?? null;
}

export const requireInterviewApproval: RequestHandler = async (req, res, next) => {
  if (req.method === "GET" && req.originalUrl.split("?")[0] === "/api/vendor-conversations/support") {
    next();
    return;
  }
  const authorization = req.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (data.user.app_metadata?.role === "admin") {
    next();
    return;
  }
  try {
    if (await getInterviewStatus(data.user) === "Approved") {
      next();
      return;
    }
    res.status(403).json({ error: "Complete the interview and receive administrator approval before accessing contributor tools.", interviewRequired: true });
  } catch (verificationError) {
    console.error("[api] Unable to verify contributor interview approval.", verificationError);
    res.status(503).json({ error: "Unable to verify contributor access right now." });
  }
};
