import type { RequestHandler } from "express";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";

export const getAdminReviewCounts: RequestHandler = async (req, res) => {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (userData.user.app_metadata?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    console.error("[api] Review counts not configured", error);
    res.status(503).json({ error: "Review counts are not configured on the server." });
    return;
  }

  const [applications, interviews, deviceRequests, kyc] = await Promise.all([
    service.from("applications").select("id", { count: "exact", head: true }).eq("status", "Under Review"),
    service.from("interview_submissions").select("id", { count: "exact", head: true }).eq("status", "Under Review").not("submitted_at", "is", null),
    service.from("payment_requests").select("id", { count: "exact", head: true }).in("status", ["Pending Review", "Under Review"]),
    service.from("contributor_kyc_submissions").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const failed = applications.error ?? interviews.error ?? deviceRequests.error ?? kyc.error;
  if (failed) {
    console.error("[api] Unable to load review counts.", failed);
    res.status(500).json({ error: "Unable to load review counts." });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    pendingApplications: applications.count ?? 0,
    pendingInterviews: interviews.count ?? 0,
    pendingDeviceRequests: deviceRequests.count ?? 0,
    pendingKyc: kyc.count ?? 0,
  });
};

export const getAdminDashboardStats: RequestHandler = async (req, res) => {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (userData.user.app_metadata?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    console.error("[api] Dashboard stats not configured", error);
    res.status(503).json({ error: "Dashboard statistics are not configured on the server." });
    return;
  }

  const [applications, pendingApplications, deviceRequests, pendingDeviceRequests, pendingInterviews, activeConversations, devices] = await Promise.all([
    service.from("applications").select("id", { count: "exact", head: true }),
    service.from("applications").select("id", { count: "exact", head: true }).eq("status", "Under Review"),
    service.from("payment_requests").select("id", { count: "exact", head: true }),
    service.from("payment_requests").select("id", { count: "exact", head: true }).eq("status", "Pending Review"),
    service.from("interview_submissions").select("id", { count: "exact", head: true }).eq("status", "Under Review").not("submitted_at", "is", null),
    service.from("vendor_conversations").select("id", { count: "exact", head: true }).eq("status", "active"),
    service.from("devices").select("id", { count: "exact", head: true }).eq("status", "Available"),
  ]);
  const failed = applications.error ?? pendingApplications.error ?? deviceRequests.error ?? pendingDeviceRequests.error ?? pendingInterviews.error ?? activeConversations.error ?? devices.error;
  if (failed) {
    console.error("[api] Unable to load dashboard statistics.", failed);
    res.status(500).json({ error: "Unable to load dashboard statistics." });
    return;
  }

  let availableBalance = 0;
  let pendingEarnings = 0;
  const perPage = 1000;
  for (let from = 0; ; from += perPage) {
    const { data, error } = await service.from("contributor_earnings").select("user_id, available_balance, pending_earnings").order("user_id").range(from, from + perPage - 1);
    if (error) {
      console.error("[api] Unable to load earnings totals.", error);
      res.status(500).json({ error: "Unable to load dashboard statistics." });
      return;
    }
    for (const row of data ?? []) {
      availableBalance += Number(row.available_balance) || 0;
      pendingEarnings += Number(row.pending_earnings) || 0;
    }
    if ((data ?? []).length < perPage) break;
  }

  let users = 0;
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[api] Unable to count users.", error);
      res.status(500).json({ error: "Unable to load dashboard statistics." });
      return;
    }
    users += data.users.filter((user) => user.app_metadata?.role !== "admin").length;
    if (data.users.length < perPage) break;
  }

  res.json({
    users,
    applications: applications.count ?? 0,
    pendingApplications: pendingApplications.count ?? 0,
    deviceRequests: deviceRequests.count ?? 0,
    pendingDeviceRequests: pendingDeviceRequests.count ?? 0,
    pendingInterviews: pendingInterviews.count ?? 0,
    activeConversations: activeConversations.count ?? 0,
    availableDevices: devices.count ?? 0,
    availableBalance,
    pendingEarnings,
  });
};
