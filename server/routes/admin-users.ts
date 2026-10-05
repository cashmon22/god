import type { Request, RequestHandler } from "express";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { createServiceRoleSupabaseClient, supabase } from "../lib/supabase";
import { deleteOptionalRows, isMissingOptionalSchemaObject } from "../lib/admin-deletions";
import { notifyUser } from "../lib/notifications";
import type { AdminUser, AdminUserStatus } from "../../shared/admin-users";
import { assignments } from "../../client/lib/assignments";

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

function toAdminUser(user: User): AdminUser {
  const name = typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
    ? user.user_metadata.full_name.trim()
    : user.email?.split("@")[0] || "Unnamed user";
  const isSuspended = Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now());

  return {
    id: user.id,
    name,
    email: user.email ?? "",
    createdAt: user.created_at,
    status: isSuspended ? "Suspended" : "Active",
    lastSignInAt: user.last_sign_in_at ?? null,
    isAdmin: user.app_metadata?.role === "admin",
  };
}

function getServiceRoleClient(res: Parameters<RequestHandler>[1]) {
  try {
    return createServiceRoleSupabaseClient();
  } catch {
    res.status(503).json({ error: "Admin user data is not configured." });
    return null;
  }
}

const createUserSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(12),
  fullName: z.string().trim().max(120).optional(),
});

export const createAdminUser: RequestHandler = async (req, res) => {
  const admin = await getAdminUser(req, res);
  if (!admin) return;

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email, a password of at least 12 characters, and a valid optional name." });
    return;
  }

  const serviceSupabase = getServiceRoleClient(res);
  if (!serviceSupabase) return;

  const email = parsed.data.email.trim().toLowerCase();
  const fullName = parsed.data.fullName?.trim();
  const { data, error } = await serviceSupabase.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
    ...(fullName ? { user_metadata: { full_name: fullName } } : {}),
  });

  if (error) {
    if (/already (registered|exists)|already been registered|user already/i.test(error.message)) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    res.status(400).json({ error: "Unable to create user. Check the account details and try again." });
    return;
  }

  if (!data.user) {
    res.status(500).json({ error: "Unable to create user." });
    return;
  }

  const { data: application, error: applicationError } = await serviceSupabase.from("applications")
    .select("referral_owner_user_id, status")
    .ilike("email", email)
    .not("referral_owner_user_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (applicationError) {
    console.error("[api] Unable to load application referral attribution.", applicationError);
  } else if (application?.referral_owner_user_id && application.referral_owner_user_id !== data.user.id) {
    const referralStatus = application.status === "Approved" ? "Successful" : application.status === "Rejected" ? "Rejected" : "Pending";
    const { error: referralError } = await serviceSupabase.rpc("qualify_contributor_referral", {
      target_referred_user_id: data.user.id,
      target_referrer_user_id: application.referral_owner_user_id,
      qualification_status: referralStatus,
      acting_admin_id: admin.id,
    });
    if (referralError) {
      console.error("[api] Unable to record contributor referral.", referralError);
      res.status(500).json({ error: "The user was created, but referral qualification could not be recorded." });
      return;
    }
  }

  res.status(201).json({
    id: data.user.id,
    email: data.user.email ?? email,
    name: fullName || data.user.email?.split("@")[0] || "Unnamed user",
    createdAt: data.user.created_at,
  });
};

export const listAdminUsers: RequestHandler = async (req, res) => {
  const admin = await getAdminUser(req, res);
  if (!admin) return;
  const serviceSupabase = getServiceRoleClient(res);
  if (!serviceSupabase) return;

  const { data, error } = await serviceSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.error("[api] Unable to load users.", error);
    res.status(500).json({ error: "Unable to load users." });
    return;
  }

  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const users = data.users
    .map(toAdminUser)
    .filter((user) => !search || user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search));

  res.json({ users, total: users.length });
};

export const getAdminUserDetails: RequestHandler = async (req, res) => {
  const admin = await getAdminUser(req, res);
  if (!admin) return;
  const serviceSupabase = getServiceRoleClient(res);
  if (!serviceSupabase) return;
  const userId = typeof req.params.id === "string" ? req.params.id : "";
  if (!userId) {
    res.status(400).json({ error: "A user id is required." });
    return;
  }

  const { data, error } = await serviceSupabase.auth.admin.getUserById(userId);
  if (error || !data.user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  res.json(toAdminUser(data.user));
};

export const getAdminContributorOverview: RequestHandler = async (req, res) => {
  const admin = await getAdminUser(req, res);
  if (!admin) return;
  const serviceSupabase = getServiceRoleClient(res);
  if (!serviceSupabase) return;
  const userId = typeof req.params.id === "string" ? req.params.id : "";
  if (!userId) {
    res.status(400).json({ error: "A user id is required." });
    return;
  }

  const { data: authData, error: authError } = await serviceSupabase.auth.admin.getUserById(userId);
  if (authError || !authData.user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  const [applications, deviceRequests, tasks, earnings, conversations] = await Promise.all([
    serviceSupabase.from("applications").select("first_name, last_name, email, phone, status, verification_status, created_at").ilike("email", authData.user.email ?? "").order("created_at", { ascending: false }).limit(1),
    serviceSupabase.from("payment_requests").select("id, device_name, device_model, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    serviceSupabase.from("contributor_tasks").select("id, assignment_id, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    serviceSupabase.from("contributor_earnings").select("available_balance, pending_earnings, total_withdrawn").eq("user_id", userId).maybeSingle(),
    serviceSupabase.from("vendor_conversations").select("id, conversation_type, status, last_message, last_message_at, admin_unread_count").eq("user_id", userId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(20),
  ]);
  const taskSchemaMissing = isMissingOptionalSchemaObject(tasks.error);
  const failed = applications.error ?? deviceRequests.error ?? (taskSchemaMissing ? null : tasks.error) ?? earnings.error ?? conversations.error;
  if (failed) {
    console.error("[api] Unable to load contributor overview.", failed);
    res.status(500).json({ error: "Unable to load contributor overview." });
    return;
  }

  const application = applications.data?.[0] ?? null;

  res.json({
    phone: typeof authData.user.user_metadata?.phone === "string" ? authData.user.user_metadata.phone : application?.phone ?? null,
    application: application ? {
      fullName: `${application.first_name ?? ""} ${application.last_name ?? ""}`.trim(),
      email: application.email,
      phone: application.phone,
      status: application.status,
      verificationStatus: application.verification_status,
      submittedAt: application.created_at,
    } : null,
    deviceRequests: (deviceRequests.data ?? []).map((request) => ({
      id: request.id,
      deviceName: request.device_name,
      deviceModel: request.device_model,
      status: request.status,
      createdAt: request.created_at,
    })),
    tasks: (taskSchemaMissing ? [] : tasks.data ?? []).map((task) => {
      const assignment = assignments.find((item) => item.id === task.assignment_id);
      return {
        id: task.id,
        assignmentId: task.assignment_id,
        title: assignment?.title ?? task.assignment_id,
        category: assignment?.category ?? "Assignment",
        status: task.status,
        createdAt: task.created_at,
        reward: assignment?.reward ?? 0,
      };
    }),
    earnings: earnings.data ? {
      availableBalance: Number(earnings.data.available_balance) || 0,
      pendingEarnings: Number(earnings.data.pending_earnings) || 0,
      totalWithdrawn: Number(earnings.data.total_withdrawn) || 0,
    } : null,
    conversations: (conversations.data ?? []).map((conversation) => ({
      id: conversation.id,
      type: conversation.conversation_type,
      status: conversation.status,
      lastMessage: conversation.last_message,
      lastMessageAt: conversation.last_message_at,
      unreadCount: conversation.admin_unread_count ?? 0,
    })),
  });
};

export const deleteAdminUser: RequestHandler = async (req, res) => {
  const admin = await getAdminUser(req, res);
  if (!admin) return;
  const serviceSupabase = getServiceRoleClient(res);
  if (!serviceSupabase) return;
  const userId = typeof req.params.id === "string" ? req.params.id : "";
  if (!userId) {
    res.status(400).json({ error: "A user id is required." });
    return;
  }

  try {
    const { data, error } = await serviceSupabase.auth.admin.getUserById(userId);
    if (error || !data.user) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    if (data.user.app_metadata?.role === "admin") {
      res.status(403).json({ error: "Administrator accounts cannot be deleted." });
      return;
    }

    const { data: conversations, error: conversationsError } = await serviceSupabase
      .from("vendor_conversations")
      .select("id")
      .eq("user_id", userId);
    if (conversationsError && !isMissingOptionalSchemaObject(conversationsError)) throw conversationsError;

    const conversationIds = (conversations ?? []).map((conversation) => conversation.id as string);
    if (conversationIds.length) {
      await deleteOptionalRows(() => serviceSupabase.from("vendor_messages").delete().in("conversation_id", conversationIds));
    }
    await deleteOptionalRows(() => serviceSupabase.from("vendor_messages").delete().eq("sender_id", userId));
    await deleteOptionalRows(() => serviceSupabase.from("vendor_conversations").delete().eq("user_id", userId));
    await deleteOptionalRows(() => serviceSupabase.from("payment_requests").delete().eq("user_id", userId));
    await deleteOptionalRows(() => serviceSupabase.from("notifications").delete().eq("user_id", userId));
    await deleteOptionalRows(() => serviceSupabase.from("contributor_earnings").delete().eq("user_id", userId));
    await deleteOptionalRows(() => serviceSupabase.from("balance_transactions").delete().eq("user_id", userId));

    if (data.user.email) {
      await deleteOptionalRows(() => serviceSupabase.from("applications").delete().ilike("email", data.user.email!));
    }

    const { error: authError } = await serviceSupabase.auth.admin.deleteUser(userId);
    if (authError) throw authError;
    res.json({ id: userId });
  } catch (deleteError) {
    console.error("[api] Unable to delete user and linked records.", deleteError);
    res.status(500).json({ error: "Unable to delete user and linked records." });
  }
};

export const updateAdminUserStatus: RequestHandler = async (req, res) => {
  const admin = await getAdminUser(req, res);
  if (!admin) return;
  const serviceSupabase = getServiceRoleClient(res);
  if (!serviceSupabase) return;
  const userId = typeof req.params.id === "string" ? req.params.id : "";
  if (!userId) {
    res.status(400).json({ error: "A user id is required." });
    return;
  }

  const status = req.body?.status as AdminUserStatus;
  if (status !== "Active" && status !== "Suspended") {
    res.status(400).json({ error: "Invalid account status." });
    return;
  }

  const { data, error } = await serviceSupabase.auth.admin.updateUserById(userId, {
    ban_duration: status === "Suspended" ? "876000h" : "none",
  });
  if (error || !data.user) {
    console.error("[api] Unable to update account status.", error);
    res.status(500).json({ error: "Unable to update account status." });
    return;
  }

  void notifyUser({
    userId,
    type: "balance_adjusted",
    title: status === "Suspended" ? "Account Suspended" : "Account Reactivated",
    message:
      status === "Suspended"
        ? "Your account has been suspended. Please contact support for assistance."
        : "Your account has been reactivated. You can resume using the platform.",
    link: "/dashboard",
  });

  res.json(toAdminUser(data.user));
};
