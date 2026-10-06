import path from "node:path";
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import crypto$1 from "node:crypto";
import { z } from "zod";
//#region server/routes/program.ts
var handleProgramStatus = (_req, res) => {
	res.status(200).json({ message: "Amazon Contributor Program API" });
};
//#endregion
//#region server/lib/supabase.ts
var supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
var supabasePublishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
var supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
function getSupabaseUrl() {
	if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured");
	return supabaseUrl;
}
var clientOptions = { auth: {
	persistSession: false,
	autoRefreshToken: false,
	detectSessionInUrl: false
} };
var _client;
function getClient() {
	if (!_client) _client = createClient(getSupabaseUrl(), supabasePublishableKey, clientOptions);
	return _client;
}
var supabase = new Proxy({}, { get(_target, prop, receiver) {
	const client = getClient();
	const value = Reflect.get(client, prop, receiver);
	return typeof value === "function" ? value.bind(client) : value;
} });
function createAuthenticatedSupabaseClient(accessToken) {
	return createClient(getSupabaseUrl(), supabasePublishableKey, {
		...clientOptions,
		global: { headers: { Authorization: `Bearer ${accessToken}` } }
	});
}
function createServiceRoleSupabaseClient() {
	if (!supabaseServiceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
	return createClient(getSupabaseUrl(), supabaseServiceRoleKey, clientOptions);
}
//#endregion
//#region server/routes/admin-dashboard.ts
var getAdminReviewCounts = async (req, res) => {
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
		service.from("applications").select("id", {
			count: "exact",
			head: true
		}).eq("status", "Under Review"),
		service.from("interview_submissions").select("id", {
			count: "exact",
			head: true
		}).eq("status", "Under Review").not("submitted_at", "is", null),
		service.from("payment_requests").select("id", {
			count: "exact",
			head: true
		}).in("status", ["Pending Review", "Under Review"]),
		service.from("contributor_kyc_submissions").select("id", {
			count: "exact",
			head: true
		}).eq("status", "pending")
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
		pendingKyc: kyc.count ?? 0
	});
};
var getAdminDashboardStats = async (req, res) => {
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
		service.from("applications").select("id", {
			count: "exact",
			head: true
		}),
		service.from("applications").select("id", {
			count: "exact",
			head: true
		}).eq("status", "Under Review"),
		service.from("payment_requests").select("id", {
			count: "exact",
			head: true
		}),
		service.from("payment_requests").select("id", {
			count: "exact",
			head: true
		}).eq("status", "Pending Review"),
		service.from("interview_submissions").select("id", {
			count: "exact",
			head: true
		}).eq("status", "Under Review").not("submitted_at", "is", null),
		service.from("vendor_conversations").select("id", {
			count: "exact",
			head: true
		}).eq("status", "active"),
		service.from("devices").select("id", {
			count: "exact",
			head: true
		}).eq("status", "Available")
	]);
	const failed = applications.error ?? pendingApplications.error ?? deviceRequests.error ?? pendingDeviceRequests.error ?? pendingInterviews.error ?? activeConversations.error ?? devices.error;
	if (failed) {
		console.error("[api] Unable to load dashboard statistics.", failed);
		res.status(500).json({ error: "Unable to load dashboard statistics." });
		return;
	}
	let availableBalance = 0;
	let pendingEarnings = 0;
	const perPage = 1e3;
	for (let from = 0;; from += perPage) {
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
	for (let page = 1;; page += 1) {
		const { data, error } = await service.auth.admin.listUsers({
			page,
			perPage
		});
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
		pendingEarnings
	});
};
//#endregion
//#region server/lib/notifications.ts
/**
* Create a notification for a specific user.
* Fire-and-forget — errors are logged but never thrown.
*/
async function notifyUser(params) {
	try {
		const { error } = await createServiceRoleSupabaseClient().from("notifications").insert({
			user_id: params.userId,
			recipient_role: "user",
			type: params.type,
			title: params.title,
			message: params.message,
			link: params.link ?? null,
			related_id: params.relatedId ?? null,
			is_read: false
		});
		if (error) console.error("[notifyUser] Failed:", error.message, error.code);
	} catch (err) {
		console.error("[notifyUser] Error:", err);
	}
}
/**
* Create a notification for every admin user.
* Fetches all admin users via the Supabase Admin API and inserts one row per admin.
* Fire-and-forget — errors are logged but never thrown.
*/
async function notifyAdmins(params) {
	try {
		const serviceSupabase = createServiceRoleSupabaseClient();
		const adminIds = [];
		let page = 1;
		let hasMore = true;
		while (hasMore) {
			const { data, error } = await serviceSupabase.auth.admin.listUsers({
				page,
				perPage: 100
			});
			if (error) {
				console.error("[notifyAdmins] Failed to list users:", error.message);
				return;
			}
			for (const u of data.users) if (u.app_metadata?.role === "admin") adminIds.push(u.id);
			hasMore = data.users.length === 100;
			page++;
		}
		if (adminIds.length === 0) return;
		const existingUserIds = /* @__PURE__ */ new Set();
		if (params.relatedId && (params.type === "new_application" || params.type === "new_device_request")) {
			const { data: existing, error: lookupError } = await serviceSupabase.from("notifications").select("user_id").eq("recipient_role", "admin").eq("type", params.type).eq("related_id", params.relatedId);
			if (lookupError) console.error("[notifyAdmins] Failed to check existing notifications:", lookupError.message);
			else for (const notification of existing ?? []) existingUserIds.add(notification.user_id);
		}
		const rows = adminIds.filter((userId) => !existingUserIds.has(userId)).map((userId) => ({
			user_id: userId,
			recipient_role: "admin",
			type: params.type,
			title: params.title,
			message: params.message,
			link: params.link ?? null,
			related_id: params.relatedId ?? null,
			is_read: false
		}));
		if (rows.length === 0) return;
		const { error: insertError } = await serviceSupabase.from("notifications").insert(rows);
		if (insertError) console.error("[notifyAdmins] Failed to insert:", insertError.message, insertError.code);
	} catch (err) {
		console.error("[notifyAdmins] Error:", err);
	}
}
//#endregion
//#region server/lib/admin-deletions.ts
function isMissingOptionalSchemaObject(error) {
	return !!error && [
		"42P01",
		"42703",
		"PGRST204",
		"PGRST205"
	].includes(error.code ?? "");
}
async function deleteOptionalRows(deleteRows) {
	const { error } = await deleteRows();
	if (error && !isMissingOptionalSchemaObject(error)) throw error;
}
//#endregion
//#region shared/vendor-data.ts
var vendorDevices = [
	{
		id: "macbook-air-13-m2-wfh",
		name: "MacBook Air 13-inch Remote Work Edition",
		model: "Apple M2 · 13.6-inch Liquid Retina",
		image: "https://cdn.builder.io/api/v1/image/assets%2F3c6d62f043f54b038c0855c36ba11da4%2F939428ec47fa483488bea7cdb56d4d5c?format=webp&width=800&height=1200",
		imageAlt: "Silver MacBook Air open on a home workspace",
		price: 1500,
		currency: "USD",
		ram: "16GB unified memory",
		storage: "512GB SSD",
		processor: "Apple M2 chip",
		condition: "Excellent",
		availability: "Available",
		workDeviceStatus: "Amazon Work Device",
		description: "A lightweight MacBook Air built for comfortable everyday productivity at home. Its responsive performance keeps documents, browser-based tools, and video calls moving smoothly while the long-lasting battery supports a flexible workspace.",
		features: [
			"All-day battery for untethered home-office work",
			"Clear 1080p video conferencing and professional communication",
			"Quiet multitasking across documents, email, and browser tools"
		],
		category: "Laptop"
	},
	{
		id: "macbook-air-15-m3-wfh",
		name: "MacBook Air 15-inch Collaboration Edition",
		model: "Apple M3 · 15.3-inch Liquid Retina",
		image: "https://cdn.builder.io/api/v1/image/assets%2F3c6d62f043f54b038c0855c36ba11da4%2F1ea2930b6637439cab756aa28f71f63a?format=webp&width=800&height=1200",
		imageAlt: "Gold MacBook Air closed on its original box",
		price: 2800,
		currency: "USD",
		ram: "24GB unified memory",
		storage: "1TB SSD",
		processor: "Apple M3 chip",
		condition: "Excellent",
		availability: "Available",
		workDeviceStatus: "Amazon Work Device",
		description: "This spacious 15-inch MacBook Air provides a polished home-office setup for remote collaboration. The larger display gives documents, meeting windows, and communications room to breathe, with reliable performance for demanding daily multitasking.",
		features: [
			"Expansive display for document creation and side-by-side multitasking",
			"Dependable performance for remote meetings and shared workspaces",
			"Slim portable design that transitions easily between home and travel"
		],
		category: "Laptop"
	},
	{
		id: "macbook-pro-14-m3-pro-wfh",
		name: "MacBook Pro 14-inch Productivity Edition",
		model: "Apple M3 Pro · 14.2-inch Liquid Retina XDR",
		image: "https://cdn.builder.io/api/v1/image/assets%2F3c6d62f043f54b038c0855c36ba11da4%2F1b278ca607ad4a54a17684c711ada685?format=webp&width=800&height=1200",
		imageAlt: "Silver MacBook Air open and starting on a home desk",
		price: 3e3,
		currency: "USD",
		ram: "36GB unified memory",
		storage: "1TB SSD",
		processor: "Apple M3 Pro chip",
		condition: "Excellent",
		availability: "Available",
		workDeviceStatus: "Amazon Work Device",
		description: "A high-capacity MacBook Pro for professionals who balance intensive projects with continuous communication. It delivers the reliable power to run multiple work applications, create polished documents, and stay present in video conferences throughout the day.",
		features: [
			"Professional-grade power for complex multitasking and creative work",
			"High-fidelity camera, microphones, and speakers for confident video calls",
			"Long battery life and a portable footprint for productive work anywhere"
		],
		category: "Laptop"
	}
];
//#endregion
//#region server/routes/payment-requests.ts
var allowedStatuses$1 = [
	"Under Review",
	"Approved",
	"Rejected",
	"Completed"
];
async function getAuthenticatedUser$2(req, res) {
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
	return {
		user: data.user,
		supabase: createAuthenticatedSupabaseClient(token)
	};
}
function isAdmin$1(user) {
	return user.app_metadata?.role === "admin";
}
function requireText(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function isMissingColumnError(error) {
	return !!error && (error.code === "42703" || error.code === "PGRST204");
}
function isLegacyStatusConstraintError(error) {
	return error?.code === "23514" && error.message?.includes("payment_requests_status_check");
}
function logPaymentRequestFailure(stage, error) {
	const details = error && typeof error === "object" ? error : {};
	console.error("Payment request failed", {
		stage,
		message: typeof details.message === "string" ? details.message : "Unknown error",
		code: typeof details.code === "string" ? details.code : void 0,
		details: typeof details.details === "string" ? details.details : void 0,
		hint: typeof details.hint === "string" ? details.hint : void 0
	});
}
var baseSelect = "id, user_id, full_legal_name, email, phone, delivery_address, city, state_province, postal_code, country, device_id, device_name, device_model, device_amount, currency, vendor, status, created_at";
var fullSelect = `${baseSelect}, rejection_reason, reviewed_at`;
function mapRequest(row) {
	return {
		id: row.id,
		userId: row.user_id,
		fullLegalName: row.full_legal_name,
		email: row.email,
		phone: row.phone,
		deliveryAddress: row.delivery_address,
		city: row.city,
		stateProvince: row.state_province,
		postalCode: row.postal_code,
		country: row.country,
		deviceId: row.device_id,
		deviceName: row.device_name,
		deviceModel: row.device_model,
		deviceAmount: row.device_amount,
		currency: row.currency,
		vendor: row.vendor,
		status: row.status === "Pending Review" ? "Under Review" : row.status,
		createdAt: row.created_at,
		rejectionReason: row.rejection_reason ?? null,
		reviewedAt: row.reviewed_at ?? null
	};
}
var createPaymentRequest = async (req, res) => {
	const context = await getAuthenticatedUser$2(req, res);
	if (!context) return;
	const { user, supabase: authenticatedSupabase } = context;
	const body = req.body;
	if (!requireText(body.deviceId) || !requireText(body.fullLegalName) || !requireText(body.phone) || !requireText(body.deliveryAddress) || !requireText(body.city) || !requireText(body.stateProvince) || !requireText(body.postalCode) || !requireText(body.country) || body.confirmation !== true) {
		res.status(400).json({ error: "Complete all required fields and confirm the information provided." });
		return;
	}
	const { data: existingActive } = await authenticatedSupabase.from("payment_requests").select(baseSelect).eq("user_id", user.id).eq("device_id", body.deviceId).in("status", [
		"Under Review",
		"Pending Review",
		"Approved"
	]).order("created_at", { ascending: false }).limit(1).maybeSingle();
	if (existingActive) {
		res.status(200).json(mapRequest(existingActive));
		return;
	}
	let device = vendorDevices.find((item) => item.id === body.deviceId);
	if (!device) {
		const { data: databaseDevice, error: databaseDeviceError } = await authenticatedSupabase.from("devices").select("id,name,model,amount,status").eq("id", body.deviceId).eq("status", "Available").maybeSingle();
		if (databaseDeviceError) {
			logPaymentRequestFailure("device lookup", databaseDeviceError);
			res.status(500).json({ error: "Unable to verify the selected device." });
			return;
		}
		if (databaseDevice) device = {
			id: databaseDevice.id,
			name: databaseDevice.name,
			model: databaseDevice.model,
			price: databaseDevice.amount,
			currency: "USD"
		};
	}
	if (!device) {
		res.status(400).json({ error: "The selected device is not available." });
		return;
	}
	const paymentRequestValues = {
		id: crypto$1.randomUUID(),
		user_id: user.id,
		full_legal_name: body.fullLegalName.trim(),
		email: user.email ?? "",
		phone: body.phone.trim(),
		delivery_address: body.deliveryAddress.trim(),
		city: body.city.trim(),
		state_province: body.stateProvince.trim(),
		postal_code: body.postalCode.trim(),
		country: body.country.trim(),
		device_id: device.id,
		device_name: device.name,
		device_model: device.model,
		device_amount: device.price,
		currency: device.currency,
		vendor: "Trusted Vendor",
		status: "Under Review"
	};
	let result = await authenticatedSupabase.from("payment_requests").insert(paymentRequestValues).select(baseSelect).single();
	if (isLegacyStatusConstraintError(result.error)) result = await authenticatedSupabase.from("payment_requests").insert({
		...paymentRequestValues,
		status: "Pending Review"
	}).select(baseSelect).single();
	if (result.error) {
		logPaymentRequestFailure("payment request insert", result.error);
		console.error("[api] Unable to save the payment request.", result.error);
		res.status(500).json({ error: "Unable to save the payment request." });
		return;
	}
	await notifyAdmins({
		type: "new_device_request",
		title: "New Device Request",
		message: `${body.fullLegalName} submitted a payment/device request for ${device.name}.`,
		link: "/admin/device-requests",
		relatedId: result.data.id
	});
	res.status(201).json(mapRequest(result.data));
};
var listPaymentRequests = async (req, res) => {
	const context = await getAuthenticatedUser$2(req, res);
	if (!context) return;
	const { user, supabase: authenticatedSupabase } = context;
	let query = authenticatedSupabase.from("payment_requests").select(fullSelect).order("created_at", { ascending: false });
	if (!isAdmin$1(user)) query = query.eq("user_id", user.id);
	let data;
	let result = await query;
	if (isMissingColumnError(result.error)) {
		let fallbackQuery = authenticatedSupabase.from("payment_requests").select(baseSelect).order("created_at", { ascending: false });
		if (!isAdmin$1(user)) fallbackQuery = fallbackQuery.eq("user_id", user.id);
		const fallback = await fallbackQuery;
		data = fallback.data;
		result = {
			data: fallback.data,
			error: fallback.error
		};
	} else data = result.data;
	const error = result.error;
	if (error) {
		console.error("[api] Unable to load payment requests.", error);
		res.status(500).json({ error: "Unable to load payment requests." });
		return;
	}
	res.json(data.map(mapRequest));
};
var updatePaymentRequestStatus = async (req, res) => {
	const context = await getAuthenticatedUser$2(req, res);
	if (!context) return;
	const { user } = context;
	if (!isAdmin$1(user)) {
		res.status(403).json({ error: "Administrator access required" });
		return;
	}
	const status = req.body?.status;
	if (!allowedStatuses$1.includes(status)) {
		res.status(400).json({ error: "Invalid payment request status" });
		return;
	}
	const rejectionReason = typeof req.body?.rejectionReason === "string" ? req.body.rejectionReason.trim() : null;
	const updateData = {
		status,
		reviewed_at: (/* @__PURE__ */ new Date()).toISOString()
	};
	if (status === "Rejected" && rejectionReason) updateData.rejection_reason = rejectionReason;
	else if (status !== "Rejected") updateData.rejection_reason = null;
	const serviceSupabase = createServiceRoleSupabaseClient();
	const { data: existingRecord } = await serviceSupabase.from("payment_requests").select("id, user_id, device_name").eq("id", req.params.id).maybeSingle();
	let { data, error } = await serviceSupabase.from("payment_requests").update(updateData).eq("id", req.params.id).select("id, status").single();
	if (isMissingColumnError(error)) {
		const fallback = await serviceSupabase.from("payment_requests").update({ status }).eq("id", req.params.id).select("id, status").single();
		data = fallback.data;
		error = fallback.error;
	}
	if (error) {
		logPaymentRequestFailure("status update", error);
		console.error("[api] Unable to update payment request status.", error);
		res.status(500).json({ error: "Unable to update payment request status." });
		return;
	}
	const { error: conversationStatusError } = await serviceSupabase.from("vendor_conversations").update({ request_status: status }).eq("payment_request_id", req.params.id).eq("conversation_type", "vendor");
	if (conversationStatusError) console.error("[api] Unable to synchronize conversation request status.", conversationStatusError);
	if (existingRecord?.user_id) {
		const deviceName = existingRecord.device_name ?? "your device";
		if (status === "Approved") await notifyUser({
			userId: existingRecord.user_id,
			type: "device_approved",
			title: "Device Request Approved",
			message: `Your request for ${deviceName} has been approved.`,
			link: "/dashboard",
			relatedId: String(req.params.id)
		});
		else if (status === "Rejected") await notifyUser({
			userId: existingRecord.user_id,
			type: "device_rejected",
			title: "Device Request Rejected",
			message: rejectionReason ? `Your request for ${deviceName} was rejected. Reason: ${rejectionReason}` : `Your request for ${deviceName} was rejected.`,
			link: "/dashboard",
			relatedId: String(req.params.id)
		});
	}
	res.json(data);
};
var deletePaymentRequest = async (req, res) => {
	const context = await getAuthenticatedUser$2(req, res);
	if (!context) return;
	const { user } = context;
	if (!isAdmin$1(user)) {
		res.status(403).json({ error: "Administrator access required" });
		return;
	}
	const serviceSupabase = createServiceRoleSupabaseClient();
	try {
		const { data: conversations, error: lookupError } = await serviceSupabase.from("vendor_conversations").select("id").eq("payment_request_id", req.params.id).eq("conversation_type", "vendor");
		if (lookupError && !isMissingOptionalSchemaObject(lookupError)) throw lookupError;
		const conversationIds = (conversations ?? []).map((conversation) => conversation.id);
		if (conversationIds.length) {
			await deleteOptionalRows(() => serviceSupabase.from("vendor_messages").delete().in("conversation_id", conversationIds));
			await deleteOptionalRows(() => serviceSupabase.from("vendor_conversations").delete().in("id", conversationIds));
		}
		const { data, error } = await serviceSupabase.from("payment_requests").delete().eq("id", req.params.id).select("id").maybeSingle();
		if (error) throw error;
		if (!data) {
			res.status(404).json({ error: "Device request not found." });
			return;
		}
		res.json(data);
	} catch (deleteError) {
		logPaymentRequestFailure("delete", deleteError);
		console.error("[api] Unable to delete payment request.", deleteError);
		res.status(500).json({ error: "Unable to delete device request." });
	}
};
//#endregion
//#region client/lib/assignments.ts
var assignments = [
	{
		id: "asg-001",
		title: "Product Feature Research",
		category: "Product Research",
		description: "Research assigned products and collect accurate information about product features, specifications, sizes, colors, compatibility, and other relevant details.",
		estimatedTime: "45 min",
		reward: 65,
		status: "Available"
	},
	{
		id: "asg-002",
		title: "Product Listing Verification",
		category: "Product Data Verification",
		description: "Review product listing information and identify missing, inaccurate, outdated, or inconsistent product details across assigned marketplace listings.",
		estimatedTime: "30 min",
		reward: 35,
		status: "Available"
	},
	{
		id: "asg-003",
		title: "Marketplace Category Assignment",
		category: "Product Categorization",
		description: "Assign products to the appropriate marketplace category and subcategory based on the provided classification guidelines and product information.",
		estimatedTime: "25 min",
		reward: 50,
		status: "Available"
	},
	{
		id: "asg-004",
		title: "Product Attribute Validation",
		category: "Product Attribute Review",
		description: "Review product listings and verify attributes such as brand, material, dimensions, color, size, compatibility, and product type for accuracy and completeness.",
		estimatedTime: "35 min",
		reward: 50,
		status: "Available"
	},
	{
		id: "asg-005",
		title: "Shopper Search Relevance Rating",
		category: "Search Relevance Evaluation",
		description: "Review shopper search queries and product results, then rate how relevant each result is to the searcher's intent and expectations.",
		estimatedTime: "40 min",
		reward: 65,
		status: "Available"
	},
	{
		id: "asg-006",
		title: "Product Listing Quality Assessment",
		category: "Product Listing Quality Review",
		description: "Evaluate product titles, bullet points, descriptions, and listing information for completeness, clarity, and consistency with marketplace standards.",
		estimatedTime: "50 min",
		reward: 80,
		status: "Available"
	},
	{
		id: "asg-007",
		title: "Product Image Quality Review",
		category: "Product Image Review",
		description: "Review product images for quality, clarity, relevance, and whether the images accurately represent the listed product and its key features.",
		estimatedTime: "20 min",
		reward: 20,
		status: "Available"
	},
	{
		id: "asg-008",
		title: "Customer Review Theme Analysis",
		category: "Product Review Analysis",
		description: "Analyze existing customer reviews to identify recurring themes, customer concerns, product issues, and overall sentiment trends for assigned products.",
		estimatedTime: "60 min",
		reward: 100,
		status: "Available"
	},
	{
		id: "asg-009",
		title: "Marketplace Pricing Verification",
		category: "Pricing Research",
		description: "Research and verify product pricing information for assigned marketplace products, comparing listed prices against current market data.",
		estimatedTime: "35 min",
		reward: 50,
		status: "Available"
	},
	{
		id: "asg-010",
		title: "Product Availability Check",
		category: "Product Availability Research",
		description: "Check assigned products for availability and record relevant availability information including stock status, variants, and regional differences.",
		estimatedTime: "25 min",
		reward: 35,
		status: "Available"
	},
	{
		id: "asg-011",
		title: "Shopping Experience Evaluation",
		category: "Shopping Experience Evaluation",
		description: "Complete assigned shopping scenarios and provide structured feedback about search, navigation, product information, and overall shopping usability.",
		estimatedTime: "75 min",
		reward: 125,
		status: "Available"
	},
	{
		id: "asg-012",
		title: "Competitor Product Comparison",
		category: "Competitor Product Research",
		description: "Research comparable products and record differences in features, specifications, pricing, and marketplace positioning relative to assigned target products.",
		estimatedTime: "90 min",
		reward: 150,
		status: "Available"
	},
	{
		id: "asg-013",
		title: "Product Content Taxonomy Classification",
		category: "Product Content Classification",
		description: "Classify product titles, descriptions, and other marketplace content according to the provided taxonomy and classification guidelines.",
		estimatedTime: "30 min",
		reward: 50,
		status: "Limited"
	}
];
//#endregion
//#region server/routes/admin-users.ts
async function getAdminUser$3(req, res) {
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
function toAdminUser(user) {
	const name = typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim() ? user.user_metadata.full_name.trim() : user.email?.split("@")[0] || "Unnamed user";
	const isSuspended = Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now());
	return {
		id: user.id,
		name,
		email: user.email ?? "",
		createdAt: user.created_at,
		status: isSuspended ? "Suspended" : "Active",
		lastSignInAt: user.last_sign_in_at ?? null,
		isAdmin: user.app_metadata?.role === "admin"
	};
}
function getServiceRoleClient$1(res) {
	try {
		return createServiceRoleSupabaseClient();
	} catch {
		res.status(503).json({ error: "Admin user data is not configured." });
		return null;
	}
}
var createUserSchema = z.object({
	email: z.string().trim().pipe(z.email()),
	password: z.string().min(12),
	fullName: z.string().trim().max(120).optional()
});
var createAdminUser = async (req, res) => {
	const admin = await getAdminUser$3(req, res);
	if (!admin) return;
	const parsed = createUserSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: "Enter a valid email, a password of at least 12 characters, and a valid optional name." });
		return;
	}
	const serviceSupabase = getServiceRoleClient$1(res);
	if (!serviceSupabase) return;
	const email = parsed.data.email.trim().toLowerCase();
	const fullName = parsed.data.fullName?.trim();
	const { data, error } = await serviceSupabase.auth.admin.createUser({
		email,
		password: parsed.data.password,
		email_confirm: true,
		...fullName ? { user_metadata: { full_name: fullName } } : {}
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
	const { data: application, error: applicationError } = await serviceSupabase.from("applications").select("referral_owner_user_id, status").ilike("email", email).not("referral_owner_user_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
	if (applicationError) console.error("[api] Unable to load application referral attribution.", applicationError);
	else if (application?.referral_owner_user_id && application.referral_owner_user_id !== data.user.id) {
		const referralStatus = application.status === "Approved" ? "Successful" : application.status === "Rejected" ? "Rejected" : "Pending";
		const { error: referralError } = await serviceSupabase.rpc("qualify_contributor_referral", {
			target_referred_user_id: data.user.id,
			target_referrer_user_id: application.referral_owner_user_id,
			qualification_status: referralStatus,
			acting_admin_id: admin.id
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
		createdAt: data.user.created_at
	});
};
var listAdminUsers = async (req, res) => {
	if (!await getAdminUser$3(req, res)) return;
	const serviceSupabase = getServiceRoleClient$1(res);
	if (!serviceSupabase) return;
	const { data, error } = await serviceSupabase.auth.admin.listUsers({
		page: 1,
		perPage: 1e3
	});
	if (error) {
		console.error("[api] Unable to load users.", error);
		res.status(500).json({ error: "Unable to load users." });
		return;
	}
	const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
	const users = data.users.map(toAdminUser).filter((user) => !search || user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search));
	res.json({
		users,
		total: users.length
	});
};
var getAdminUserDetails = async (req, res) => {
	if (!await getAdminUser$3(req, res)) return;
	const serviceSupabase = getServiceRoleClient$1(res);
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
var getAdminContributorOverview = async (req, res) => {
	if (!await getAdminUser$3(req, res)) return;
	const serviceSupabase = getServiceRoleClient$1(res);
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
		serviceSupabase.from("vendor_conversations").select("id, conversation_type, status, last_message, last_message_at, admin_unread_count").eq("user_id", userId).order("last_message_at", {
			ascending: false,
			nullsFirst: false
		}).limit(20)
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
			submittedAt: application.created_at
		} : null,
		deviceRequests: (deviceRequests.data ?? []).map((request) => ({
			id: request.id,
			deviceName: request.device_name,
			deviceModel: request.device_model,
			status: request.status,
			createdAt: request.created_at
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
				reward: assignment?.reward ?? 0
			};
		}),
		earnings: earnings.data ? {
			availableBalance: Number(earnings.data.available_balance) || 0,
			pendingEarnings: Number(earnings.data.pending_earnings) || 0,
			totalWithdrawn: Number(earnings.data.total_withdrawn) || 0
		} : null,
		conversations: (conversations.data ?? []).map((conversation) => ({
			id: conversation.id,
			type: conversation.conversation_type,
			status: conversation.status,
			lastMessage: conversation.last_message,
			lastMessageAt: conversation.last_message_at,
			unreadCount: conversation.admin_unread_count ?? 0
		}))
	});
};
var deleteAdminUser = async (req, res) => {
	if (!await getAdminUser$3(req, res)) return;
	const serviceSupabase = getServiceRoleClient$1(res);
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
		const { data: conversations, error: conversationsError } = await serviceSupabase.from("vendor_conversations").select("id").eq("user_id", userId);
		if (conversationsError && !isMissingOptionalSchemaObject(conversationsError)) throw conversationsError;
		const conversationIds = (conversations ?? []).map((conversation) => conversation.id);
		if (conversationIds.length) await deleteOptionalRows(() => serviceSupabase.from("vendor_messages").delete().in("conversation_id", conversationIds));
		await deleteOptionalRows(() => serviceSupabase.from("vendor_messages").delete().eq("sender_id", userId));
		await deleteOptionalRows(() => serviceSupabase.from("vendor_conversations").delete().eq("user_id", userId));
		await deleteOptionalRows(() => serviceSupabase.from("payment_requests").delete().eq("user_id", userId));
		await deleteOptionalRows(() => serviceSupabase.from("notifications").delete().eq("user_id", userId));
		await deleteOptionalRows(() => serviceSupabase.from("contributor_earnings").delete().eq("user_id", userId));
		await deleteOptionalRows(() => serviceSupabase.from("balance_transactions").delete().eq("user_id", userId));
		if (data.user.email) await deleteOptionalRows(() => serviceSupabase.from("applications").delete().ilike("email", data.user.email));
		const { error: authError } = await serviceSupabase.auth.admin.deleteUser(userId);
		if (authError) throw authError;
		res.json({ id: userId });
	} catch (deleteError) {
		console.error("[api] Unable to delete user and linked records.", deleteError);
		res.status(500).json({ error: "Unable to delete user and linked records." });
	}
};
var updateAdminUserStatus = async (req, res) => {
	if (!await getAdminUser$3(req, res)) return;
	const serviceSupabase = getServiceRoleClient$1(res);
	if (!serviceSupabase) return;
	const userId = typeof req.params.id === "string" ? req.params.id : "";
	if (!userId) {
		res.status(400).json({ error: "A user id is required." });
		return;
	}
	const status = req.body?.status;
	if (status !== "Active" && status !== "Suspended") {
		res.status(400).json({ error: "Invalid account status." });
		return;
	}
	const { data, error } = await serviceSupabase.auth.admin.updateUserById(userId, { ban_duration: status === "Suspended" ? "876000h" : "none" });
	if (error || !data.user) {
		console.error("[api] Unable to update account status.", error);
		res.status(500).json({ error: "Unable to update account status." });
		return;
	}
	notifyUser({
		userId,
		type: "balance_adjusted",
		title: status === "Suspended" ? "Account Suspended" : "Account Reactivated",
		message: status === "Suspended" ? "Your account has been suspended. Please contact support for assistance." : "Your account has been reactivated. You can resume using the platform.",
		link: "/dashboard"
	});
	res.json(toAdminUser(data.user));
};
//#endregion
//#region server/routes/admin-applications.ts
var allowedStatuses = [
	"Under Review",
	"Approved",
	"Rejected"
];
var allowedVerificationStatuses = ["Verified", "Not Verified"];
var eligibilityLabels = [
	"I am at least 18 years old.",
	"I have reliable internet access.",
	"I can follow assignment instructions accurately.",
	"I agree to Contributor Program policies.",
	"I understand applications are reviewed before approval."
];
async function getAdminUser$2(req, res) {
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
function serviceClient$4(res) {
	try {
		return createServiceRoleSupabaseClient();
	} catch {
		res.status(503).json({ error: "Admin application data is not configured." });
		return null;
	}
}
function rowEligibility(row) {
	return [
		row.age_18_plus && eligibilityLabels[0],
		row.reliable_internet && eligibilityLabels[1],
		row.follows_instructions && eligibilityLabels[2],
		row.agrees_policies && eligibilityLabels[3],
		row.understands_review && eligibilityLabels[4]
	].filter(Boolean);
}
function rowToApplication(row) {
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
		eligibility: rowEligibility(row)
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
		details
	};
}
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var RATE_LIMIT_WINDOW_MS = 6e5;
var RATE_LIMIT_MAX = 5;
var recentSubmissions = /* @__PURE__ */ new Map();
function textField(value, max) {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}
/** Best-effort per-instance throttle (serverless instances do not share memory). */
function isRateLimited(ip) {
	const now = Date.now();
	const hits = (recentSubmissions.get(ip) ?? []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
	hits.push(now);
	recentSubmissions.set(ip, hits);
	return hits.length > RATE_LIMIT_MAX;
}
var mirrorApplication = async (req, res) => {
	const body = req.body ?? {};
	if (textField(body.website, 200)) {
		res.status(400).json({ error: "Unable to save the application." });
		return;
	}
	if (isRateLimited((req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "unknown").trim())) {
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
	const experience = textField(body.experience, 2e3);
	const reason = textField(body.reason, 5e3);
	const interests = Array.isArray(body.interests) ? body.interests.filter((item) => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 100)) : [];
	const eligibility = Array.isArray(body.eligibility) ? body.eligibility.filter((item) => typeof item === "string") : [];
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
	const serviceSupabase = serviceClient$4(res);
	if (!serviceSupabase) return;
	const { data: pending, error: duplicateError } = await serviceSupabase.from("applications").select("submission_id").ilike("email", email).eq("status", "Under Review").limit(1);
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
	let applicantId = null;
	if (authToken) {
		const { data: auth, error: authError } = await supabase.auth.getUser(authToken);
		if (authError || !auth.user) {
			res.status(401).json({ error: "Authentication required" });
			return;
		}
		applicantId = auth.user.id;
	}
	let referralOwnerId = null;
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
		understands_review: eligibility.includes(eligibilityLabels[4])
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
		relatedId: applicationId
	});
	res.status(201).json({ id: applicationId });
};
/** The signed-in user's latest application (matched by linked user id or account email). */
var getMyApplication = async (req, res) => {
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
	const serviceSupabase = serviceClient$4(res);
	if (!serviceSupabase) return;
	const { data: interview, error: interviewError } = await serviceSupabase.from("interview_submissions").select("id, status, submitted_at").eq("user_id", auth.user.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
	if (interviewError) {
		res.status(500).json({ error: "Unable to load your interview status." });
		return;
	}
	if (interview) {
		res.json({ application: {
			id: interview.id,
			status: interview.status,
			verificationStatus: "Not Verified",
			submittedAt: interview.submitted_at
		} });
		return;
	}
	const email = (auth.user.email ?? "").toLowerCase();
	if (!email) {
		res.json({ application: null });
		return;
	}
	const { data, error } = await serviceSupabase.from("applications").select("submission_id, status, verification_status, created_at").ilike("email", email).order("created_at", { ascending: false }).limit(1).maybeSingle();
	if (error) {
		console.error("[api] Unable to load your application.", error);
		res.status(500).json({ error: "Unable to load your application." });
		return;
	}
	res.json({ application: data ? {
		id: data.submission_id,
		status: data.status,
		verificationStatus: data.verification_status,
		submittedAt: data.created_at
	} : null });
};
var selectColumns$1 = "id, submission_id, created_at, status, verification_status, first_name, last_name, email, phone, country, time_zone, assignment_categories, weekly_hours, previous_experience, motivation, age_18_plus, reliable_internet, follows_instructions, agrees_policies, understands_review";
async function listRows(req, res) {
	const serviceSupabase = serviceClient$4(res);
	if (!serviceSupabase) return null;
	const { data, error } = await serviceSupabase.from("applications").select(selectColumns$1).order("created_at", { ascending: false });
	if (error) {
		console.error("[api] Unable to load applications.", error);
		res.status(500).json({ error: "Unable to load applications." });
		return null;
	}
	const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
	const status = typeof req.query.status === "string" ? req.query.status : "";
	return data.map(rowToApplication).filter((application) => (!search || application.applicantName.toLowerCase().includes(search) || application.email.toLowerCase().includes(search)) && (!status || application.status === status));
}
var listAdminApplications = async (req, res) => {
	if (!await getAdminUser$2(req, res)) return;
	const applications = await listRows(req, res);
	if (!applications) return;
	res.json({
		applications,
		total: applications.length
	});
};
var getAdminApplicationDetails = async (req, res) => {
	if (!await getAdminUser$2(req, res)) return;
	const applications = await listRows(req, res);
	if (!applications) return;
	const application = applications.find((item) => item.id === req.params.id);
	if (!application) {
		res.status(404).json({ error: "Application not found." });
		return;
	}
	res.json(application);
};
var deleteAdminApplication = async (req, res) => {
	if (!await getAdminUser$2(req, res)) return;
	const serviceSupabase = serviceClient$4(res);
	if (!serviceSupabase) return;
	const { data, error } = await serviceSupabase.from("applications").delete().eq("submission_id", req.params.id).select("submission_id").maybeSingle();
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
var updateAdminApplicationStatus = async (req, res) => {
	const admin = await getAdminUser$2(req, res);
	if (!admin) return;
	const serviceSupabase = serviceClient$4(res);
	if (!serviceSupabase) return;
	const status = req.body?.status;
	if (!allowedStatuses.includes(status)) {
		res.status(400).json({ error: "Invalid application status." });
		return;
	}
	const { data: application, error } = await serviceSupabase.from("applications").update({ status }).eq("submission_id", req.params.id).select("id, submission_id, first_name, last_name, email, referral_owner_user_id").maybeSingle();
	if (error) {
		console.error("[api] Unable to update application status.", error);
		res.status(500).json({ error: "Unable to update application status." });
		return;
	}
	if (!application) {
		res.status(404).json({ error: "Application not found." });
		return;
	}
	let userId = null;
	if (application.email) {
		let page = 1;
		while (!userId) {
			const { data, error: usersError } = await serviceSupabase.auth.admin.listUsers({
				page,
				perPage: 100
			});
			if (usersError || data.users.length === 0) break;
			userId = data.users.find((candidate) => candidate.email?.toLowerCase() === application.email.toLowerCase())?.id ?? null;
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
			acting_admin_id: admin.id
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
			relatedId: application.id
		});
	}
	res.json({
		id: req.params.id,
		status
	});
};
var updateAdminApplicationVerification = async (req, res) => {
	if (!await getAdminUser$2(req, res)) return;
	const serviceSupabase = serviceClient$4(res);
	if (!serviceSupabase) return;
	const verificationStatus = req.body?.verificationStatus;
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
	res.json({
		id: req.params.id,
		verificationStatus
	});
};
//#endregion
//#region server/routes/admin-balance.ts
async function getAdminUser$1(req, res) {
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
function getServiceRoleClient(res) {
	try {
		return createServiceRoleSupabaseClient();
	} catch {
		res.status(503).json({ error: "Admin balance management is not configured." });
		return null;
	}
}
function validateUserId(req, res) {
	const userId = typeof req.params.id === "string" ? req.params.id : "";
	if (!userId) {
		res.status(400).json({ error: "A user id is required." });
		return null;
	}
	return userId;
}
function mapTransaction(row) {
	return {
		id: row.id,
		userId: row.user_id,
		amount: Number(row.amount) || 0,
		type: row.type,
		previousBalance: Number(row.previous_balance) || 0,
		newBalance: Number(row.new_balance) || 0,
		adminId: row.admin_id,
		adminNote: row.admin_note ?? null,
		createdAt: row.created_at
	};
}
var getUserBalance = async (req, res) => {
	if (!await getAdminUser$1(req, res)) return;
	const serviceSupabase = getServiceRoleClient(res);
	if (!serviceSupabase) return;
	const userId = validateUserId(req, res);
	if (!userId) return;
	const { data, error } = await serviceSupabase.from("contributor_earnings").select("available_balance").eq("user_id", userId).maybeSingle();
	if (error) {
		console.error("[api] Unable to load user balance.", error);
		res.status(500).json({ error: "Unable to load user balance." });
		return;
	}
	const balance = { availableBalance: data ? Number(data.available_balance) || 0 : 0 };
	res.json(balance);
};
var addUserBalance = async (req, res) => {
	const admin = await getAdminUser$1(req, res);
	if (!admin) return;
	const serviceSupabase = getServiceRoleClient(res);
	if (!serviceSupabase) return;
	const userId = validateUserId(req, res);
	if (!userId) return;
	const body = req.body;
	const amount = Number(body.amount);
	if (!Number.isFinite(amount) || amount <= 0) {
		res.status(400).json({ error: "A positive amount is required." });
		return;
	}
	const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
	const { data, error } = await serviceSupabase.rpc("adjust_user_balance", {
		target_user_id: userId,
		adjustment_amount: amount,
		adjustment_type: "Added",
		acting_admin_id: admin.id,
		admin_note: note
	});
	if (error) {
		console.error("[api] Unable to add balance.", error);
		res.status(500).json({ error: "Unable to add balance." });
		return;
	}
	notifyUser({
		userId,
		type: "balance_adjusted",
		title: "Balance Updated",
		message: `Your balance was increased by $${amount.toFixed(2)}.`,
		link: "/dashboard"
	});
	res.status(200).json(mapTransaction(data));
};
var removeUserBalance = async (req, res) => {
	const admin = await getAdminUser$1(req, res);
	if (!admin) return;
	const serviceSupabase = getServiceRoleClient(res);
	if (!serviceSupabase) return;
	const userId = validateUserId(req, res);
	if (!userId) return;
	const body = req.body;
	const amount = Number(body.amount);
	if (!Number.isFinite(amount) || amount <= 0) {
		res.status(400).json({ error: "A positive amount is required." });
		return;
	}
	const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
	const { data, error } = await serviceSupabase.rpc("adjust_user_balance", {
		target_user_id: userId,
		adjustment_amount: amount,
		adjustment_type: "Removed",
		acting_admin_id: admin.id,
		admin_note: note
	});
	if (error) {
		if ((error.message || "").includes("Insufficient balance")) {
			res.status(422).json({ error: "Insufficient balance. The user's balance cannot go negative." });
			return;
		}
		console.error("[api] Unable to remove balance.", error);
		res.status(500).json({ error: "Unable to remove balance." });
		return;
	}
	notifyUser({
		userId,
		type: "balance_adjusted",
		title: "Balance Updated",
		message: `Your balance was decreased by $${amount.toFixed(2)}.`,
		link: "/dashboard"
	});
	res.status(200).json(mapTransaction(data));
};
var listBalanceTransactions = async (req, res) => {
	if (!await getAdminUser$1(req, res)) return;
	const serviceSupabase = getServiceRoleClient(res);
	if (!serviceSupabase) return;
	const userId = validateUserId(req, res);
	if (!userId) return;
	const { data, error } = await serviceSupabase.from("balance_transactions").select("id, user_id, amount, type, previous_balance, new_balance, admin_id, admin_note, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
	if (error) {
		console.error("[api] Unable to load balance history.", error);
		res.status(500).json({ error: "Unable to load balance history." });
		return;
	}
	res.json((data ?? []).map((row) => mapTransaction(row)));
};
//#endregion
//#region server/routes/vendor-messages.ts
async function getAuthenticatedUser$1(req, res) {
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
	return {
		user: data.user,
		supabase: createAuthenticatedSupabaseClient(token)
	};
}
function isAdmin(user) {
	return user.app_metadata?.role === "admin";
}
function mapConversation(row) {
	return {
		id: row.id,
		userId: row.user_id,
		conversationType: row.conversation_type ?? "vendor",
		paymentRequestId: row.payment_request_id ?? null,
		deviceId: row.device_id ?? null,
		deviceName: row.device_name ?? null,
		deviceModel: row.device_model ?? null,
		referenceNumber: row.reference_number ?? null,
		userName: row.user_name,
		userEmail: row.user_email,
		requestStatus: row.request_status ?? null,
		status: row.status,
		lastMessage: row.last_message ?? null,
		lastMessageAt: row.last_message_at ?? null,
		userUnreadCount: row.user_unread_count ?? 0,
		adminUnreadCount: row.admin_unread_count ?? 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}
function mapMessage(row) {
	return {
		id: row.id,
		conversationId: row.conversation_id,
		senderId: row.sender_id,
		senderRole: row.sender_role,
		body: row.body,
		readAt: row.read_at ?? null,
		createdAt: row.created_at
	};
}
var conversationSelect = "id, user_id, conversation_type, payment_request_id, device_id, device_name, device_model, reference_number, user_name, user_email, request_status, status, last_message, last_message_at, user_unread_count, admin_unread_count, created_at, updated_at";
var messageSelect = "id, conversation_id, sender_id, sender_role, body, read_at, created_at";
function referenceNumber(id) {
	return `AMZ-${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}
var createOrGetConversation = async (req, res) => {
	const context = await getAuthenticatedUser$1(req, res);
	if (!context) return;
	const { user, supabase: authSupabase } = context;
	const { paymentRequestId } = req.body;
	if (!paymentRequestId) {
		res.status(400).json({ error: "Payment request ID is required." });
		return;
	}
	const { data: paymentRequest, error: prError } = await authSupabase.from("payment_requests").select("id, user_id, device_id, device_name, device_model, full_legal_name, email, status").eq("id", paymentRequestId).maybeSingle();
	if (prError || !paymentRequest) {
		res.status(404).json({ error: "Payment request not found." });
		return;
	}
	if (paymentRequest.user_id !== user.id) {
		res.status(403).json({ error: "You can only create conversations for your own requests." });
		return;
	}
	if (paymentRequest.status !== "Approved") {
		res.status(403).json({ error: "Your device request must be approved before you can message the vendor about this device." });
		return;
	}
	const { data: existing } = await authSupabase.from("vendor_conversations").select(conversationSelect).eq("user_id", user.id).eq("payment_request_id", paymentRequestId).eq("conversation_type", "vendor").maybeSingle();
	if (existing) {
		res.status(200).json(mapConversation(existing));
		return;
	}
	const { data, error } = await authSupabase.from("vendor_conversations").insert({
		user_id: user.id,
		conversation_type: "vendor",
		payment_request_id: paymentRequestId,
		device_id: paymentRequest.device_id,
		device_name: paymentRequest.device_name,
		device_model: paymentRequest.device_model,
		reference_number: referenceNumber(paymentRequestId),
		user_name: paymentRequest.full_legal_name,
		user_email: paymentRequest.email,
		request_status: paymentRequest.status
	}).select(conversationSelect).single();
	if (error) {
		if (error.code === "23505") {
			const { data: retry } = await authSupabase.from("vendor_conversations").select(conversationSelect).eq("user_id", user.id).eq("payment_request_id", paymentRequestId).eq("conversation_type", "vendor").maybeSingle();
			if (retry) {
				res.status(200).json(mapConversation(retry));
				return;
			}
		}
		console.error("Failed to create conversation", {
			message: error.message,
			code: error.code
		});
		console.error("[api] Unable to create conversation.", error);
		res.status(500).json({ error: "Unable to create conversation." });
		return;
	}
	res.status(201).json(mapConversation(data));
};
var listConversations = async (req, res) => {
	const context = await getAuthenticatedUser$1(req, res);
	if (!context) return;
	const { user, supabase: authSupabase } = context;
	let query = authSupabase.from("vendor_conversations").select(conversationSelect).order("last_message_at", {
		ascending: false,
		nullsFirst: false
	});
	if (!isAdmin(user)) query = query.eq("user_id", user.id);
	const typeFilter = typeof req.query.type === "string" ? req.query.type : "";
	if (typeFilter === "vendor" || typeFilter === "support") query = query.eq("conversation_type", typeFilter);
	const { data, error } = await query;
	if (error) {
		console.error("Failed to list conversations", { message: error.message });
		console.error("[api] Unable to load conversations.", error);
		res.status(500).json({ error: "Unable to load conversations." });
		return;
	}
	res.json((data ?? []).map(mapConversation));
};
var getConversation = async (req, res) => {
	const context = await getAuthenticatedUser$1(req, res);
	if (!context) return;
	const { user, supabase: authSupabase } = context;
	const { data: conversation, error: convError } = await authSupabase.from("vendor_conversations").select(conversationSelect).eq("id", req.params.id).maybeSingle();
	if (convError || !conversation) {
		res.status(404).json({ error: "Conversation not found." });
		return;
	}
	if (!isAdmin(user) && conversation.user_id !== user.id) {
		res.status(403).json({ error: "Access denied." });
		return;
	}
	const { data: messages, error: msgError } = await authSupabase.from("vendor_messages").select(messageSelect).eq("conversation_id", req.params.id).order("created_at", { ascending: true });
	if (msgError) {
		console.error("Failed to load messages", { message: msgError.message });
		res.status(500).json({ error: "Unable to load messages." });
		return;
	}
	const result = {
		...mapConversation(conversation),
		messages: (messages ?? []).map(mapMessage)
	};
	res.json(result);
};
var sendMessage = async (req, res) => {
	const context = await getAuthenticatedUser$1(req, res);
	if (!context) return;
	const { user, supabase: authSupabase } = context;
	const body = req.body?.body;
	if (typeof body !== "string" || body.trim().length === 0) {
		res.status(400).json({ error: "Message body is required." });
		return;
	}
	const { data: conversation, error: convError } = await authSupabase.from("vendor_conversations").select("id, user_id, user_name, user_unread_count, admin_unread_count").eq("id", req.params.id).maybeSingle();
	if (convError || !conversation) {
		res.status(404).json({ error: "Conversation not found." });
		return;
	}
	const admin = isAdmin(user);
	if (!admin && conversation.user_id !== user.id) {
		res.status(403).json({ error: "Access denied." });
		return;
	}
	const senderRole = admin ? "admin" : "user";
	const wasAdminUnreadZero = !admin && (conversation.admin_unread_count ?? 0) === 0;
	const { data: message, error: msgError } = await authSupabase.from("vendor_messages").insert({
		conversation_id: req.params.id,
		sender_id: user.id,
		sender_role: senderRole,
		body: body.trim()
	}).select(messageSelect).single();
	if (msgError) {
		console.error("Failed to send message", {
			message: msgError.message,
			code: msgError.code
		});
		res.status(500).json({ error: "Unable to send message." });
		return;
	}
	const serviceSupabase = createServiceRoleSupabaseClient();
	const unreadField = admin ? "user_unread_count" : "admin_unread_count";
	const currentCount = admin ? conversation.user_unread_count ?? 0 : conversation.admin_unread_count ?? 0;
	const { error: updateError } = await serviceSupabase.from("vendor_conversations").update({
		last_message: body.trim(),
		last_message_at: (/* @__PURE__ */ new Date()).toISOString(),
		[unreadField]: currentCount + 1
	}).eq("id", req.params.id);
	if (updateError) console.error("Failed to update conversation metadata", { message: updateError.message });
	if (wasAdminUnreadZero) notifyAdmins({
		type: "new_message",
		title: "New Message",
		message: `${conversation.user_name ?? "A user"} sent you a new${conversation.conversation_type === "support" ? " Support" : ""} message.`,
		link: "/admin/messages",
		relatedId: String(req.params.id)
	});
	if (admin) {
		if (conversation.user_unread_count === 0) {
			const userId = conversation.user_id;
			if (userId) notifyUser({
				userId,
				type: "new_message",
				title: "New Message",
				message: "You have received a new message from the admin team.",
				link: "/dashboard",
				relatedId: String(req.params.id)
			});
		}
	}
	res.status(201).json(mapMessage(message));
};
var deleteAdminConversation = async (req, res) => {
	const context = await getAuthenticatedUser$1(req, res);
	if (!context) return;
	if (!isAdmin(context.user)) {
		res.status(403).json({ error: "Administrator access required." });
		return;
	}
	const serviceSupabase = createServiceRoleSupabaseClient();
	try {
		const { data: conversation, error: lookupError } = await serviceSupabase.from("vendor_conversations").select("id").eq("id", req.params.id).maybeSingle();
		if (lookupError) throw lookupError;
		if (!conversation) {
			res.status(404).json({ error: "Conversation not found." });
			return;
		}
		await deleteOptionalRows(() => serviceSupabase.from("vendor_messages").delete().eq("conversation_id", req.params.id));
		const { data, error } = await serviceSupabase.from("vendor_conversations").delete().eq("id", req.params.id).select("id").maybeSingle();
		if (error) throw error;
		if (!data) {
			res.status(404).json({ error: "Conversation not found." });
			return;
		}
		res.json({ id: data.id });
	} catch (deleteError) {
		console.error("[api] Unable to delete conversation and messages.", deleteError);
		res.status(500).json({ error: "Unable to delete conversation." });
	}
};
var markConversationRead = async (req, res) => {
	const context = await getAuthenticatedUser$1(req, res);
	if (!context) return;
	const { user, supabase: authSupabase } = context;
	const { data: conversation, error: convError } = await authSupabase.from("vendor_conversations").select("id, user_id").eq("id", req.params.id).maybeSingle();
	if (convError || !conversation) {
		res.status(404).json({ error: "Conversation not found." });
		return;
	}
	const admin = isAdmin(user);
	if (!admin && conversation.user_id !== user.id) {
		res.status(403).json({ error: "Access denied." });
		return;
	}
	const otherRole = admin ? "user" : "admin";
	const { error: msgUpdateError } = await authSupabase.from("vendor_messages").update({ read_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("conversation_id", req.params.id).eq("sender_role", otherRole).is("read_at", null);
	if (msgUpdateError) console.error("Failed to mark messages read", { message: msgUpdateError.message });
	const unreadField = admin ? "admin_unread_count" : "user_unread_count";
	const { error: convUpdateError } = await createServiceRoleSupabaseClient().from("vendor_conversations").update({ [unreadField]: 0 }).eq("id", req.params.id);
	if (convUpdateError) console.error("Failed to reset unread count", { message: convUpdateError.message });
	res.json({ success: true });
};
var getOrCreateSupportConversation = async (req, res) => {
	const context = await getAuthenticatedUser$1(req, res);
	if (!context) return;
	const { user, supabase: authSupabase } = context;
	const { data: existing, error: lookupError } = await authSupabase.from("vendor_conversations").select(conversationSelect).eq("user_id", user.id).eq("conversation_type", "support").maybeSingle();
	if (lookupError) console.error("[getOrCreateSupportConversation] SELECT failed", {
		userId: user.id,
		code: lookupError.code,
		message: lookupError.message,
		details: lookupError.details,
		hint: lookupError.hint
	});
	if (existing) {
		res.json(mapConversation(existing));
		return;
	}
	const fullName = user.user_metadata?.full_name || user.email?.split("@")[0] || "User";
	const email = user.email ?? "";
	const { data, error } = await authSupabase.from("vendor_conversations").insert({
		user_id: user.id,
		conversation_type: "support",
		payment_request_id: "00000000-0000-0000-0000-000000000000",
		device_id: "support",
		device_name: "Support",
		device_model: "N/A",
		reference_number: "SUPPORT",
		user_name: fullName,
		user_email: email
	}).select(conversationSelect).single();
	if (error) {
		if (error.code === "23505") {
			const { data: retry } = await authSupabase.from("vendor_conversations").select(conversationSelect).eq("user_id", user.id).eq("conversation_type", "support").maybeSingle();
			if (retry) {
				res.json(mapConversation(retry));
				return;
			}
		}
		console.error("[getOrCreateSupportConversation] INSERT failed", {
			userId: user.id,
			code: error.code,
			message: error.message,
			details: error.details,
			hint: error.hint
		});
		console.error("[api] Unable to create support conversation.", error);
		res.status(500).json({ error: "Unable to create support conversation." });
		return;
	}
	res.status(201).json(mapConversation(data));
};
var adminCreateSupportConversation = async (req, res) => {
	const context = await getAuthenticatedUser$1(req, res);
	if (!context) return;
	const { user } = context;
	if (!isAdmin(user)) {
		res.status(403).json({ error: "Administrator access required." });
		return;
	}
	const { userId } = req.body;
	if (!userId) {
		res.status(400).json({ error: "User ID is required." });
		return;
	}
	const serviceSupabase = createServiceRoleSupabaseClient();
	const { data: existing, error: lookupError } = await serviceSupabase.from("vendor_conversations").select(conversationSelect).eq("user_id", userId).eq("conversation_type", "support").maybeSingle();
	if (lookupError) console.error("[adminCreateSupportConversation] SELECT failed", {
		adminId: user.id,
		targetUserId: userId,
		code: lookupError.code,
		message: lookupError.message,
		details: lookupError.details,
		hint: lookupError.hint
	});
	if (existing) {
		res.json(mapConversation(existing));
		return;
	}
	const { data: userInfo, error: userError } = await serviceSupabase.auth.admin.getUserById(userId);
	if (userError || !userInfo.user) {
		console.error("[adminCreateSupportConversation] getUserById failed", {
			adminId: user.id,
			targetUserId: userId,
			message: userError?.message
		});
		res.status(404).json({ error: "User not found." });
		return;
	}
	const targetUser = userInfo.user;
	const fullName = targetUser.user_metadata?.full_name || targetUser.email?.split("@")[0] || "User";
	const email = targetUser.email ?? "";
	const { data, error } = await serviceSupabase.from("vendor_conversations").insert({
		user_id: userId,
		conversation_type: "support",
		payment_request_id: "00000000-0000-0000-0000-000000000000",
		device_id: "support",
		device_name: "Support",
		device_model: "N/A",
		reference_number: "SUPPORT",
		user_name: fullName,
		user_email: email
	}).select(conversationSelect).single();
	if (error) {
		if (error.code === "23505") {
			const { data: retry } = await serviceSupabase.from("vendor_conversations").select(conversationSelect).eq("user_id", userId).eq("conversation_type", "support").maybeSingle();
			if (retry) {
				res.json(mapConversation(retry));
				return;
			}
		}
		console.error("[adminCreateSupportConversation] INSERT failed", {
			adminId: user.id,
			targetUserId: userId,
			code: error.code,
			message: error.message,
			details: error.details,
			hint: error.hint
		});
		console.error("[api] Unable to create support conversation.", error);
		res.status(500).json({ error: "Unable to create support conversation." });
		return;
	}
	res.status(201).json(mapConversation(data));
};
//#endregion
//#region server/routes/notifications.ts
async function getAuthenticatedUser(req, res) {
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
	return {
		user: data.user,
		supabase: createAuthenticatedSupabaseClient(token)
	};
}
var selectColumns = "id, user_id, recipient_role, type, title, message, link, related_id, is_read, created_at";
function mapNotification(row) {
	return {
		id: row.id,
		userId: row.user_id,
		recipientRole: row.recipient_role,
		type: row.type,
		title: row.title,
		message: row.message,
		link: row.link ?? null,
		relatedId: row.related_id ?? null,
		isRead: row.is_read ?? false,
		createdAt: row.created_at
	};
}
var listNotifications = async (req, res) => {
	const context = await getAuthenticatedUser(req, res);
	if (!context) return;
	const { supabase: authSupabase } = context;
	const { data, error } = await authSupabase.from("notifications").select(selectColumns).order("created_at", { ascending: false }).limit(50);
	if (error) {
		console.error("[listNotifications] Failed:", error.message, error.code);
		console.error("[api] Unable to load notifications.", error);
		res.status(500).json({ error: "Unable to load notifications." });
		return;
	}
	res.json((data ?? []).map(mapNotification));
};
var markNotificationRead = async (req, res) => {
	const context = await getAuthenticatedUser(req, res);
	if (!context) return;
	const { supabase: authSupabase } = context;
	const { error } = await authSupabase.from("notifications").update({ is_read: true }).eq("id", req.params.id).eq("user_id", context.user.id);
	if (error) {
		console.error("[markNotificationRead] Failed:", error.message, error.code);
		console.error("[api] Unable to mark notification.", error);
		res.status(500).json({ error: "Unable to mark notification." });
		return;
	}
	res.json({ success: true });
};
var markAllNotificationsRead = async (req, res) => {
	const context = await getAuthenticatedUser(req, res);
	if (!context) return;
	const { supabase: authSupabase } = context;
	const { error } = await authSupabase.from("notifications").update({ is_read: true }).eq("user_id", context.user.id).eq("is_read", false);
	if (error) {
		console.error("[markAllNotificationsRead] Failed:", error.message, error.code);
		console.error("[api] Unable to mark notifications.", error);
		res.status(500).json({ error: "Unable to mark notifications." });
		return;
	}
	res.json({ success: true });
};
//#endregion
//#region server/routes/contributor-tasks.ts
var taskInputSchema = z.object({ assignmentId: z.string().min(1) });
var taskColumns = "id, assignment_id, status, created_at";
async function getUser$1(req, res) {
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
function serviceClient$3(res) {
	try {
		return createServiceRoleSupabaseClient();
	} catch {
		res.status(503).json({ error: "Task data is not configured." });
		return null;
	}
}
function toTask(row) {
	const assignment = assignments.find((item) => item.id === row.assignment_id);
	return assignment ? {
		id: row.id,
		assignmentId: row.assignment_id,
		status: row.status,
		createdAt: row.created_at,
		assignment
	} : null;
}
var listContributorTasks = async (req, res) => {
	const user = await getUser$1(req, res);
	if (!user) return;
	const serviceSupabase = serviceClient$3(res);
	if (!serviceSupabase) return;
	const { data, error } = await serviceSupabase.from("contributor_tasks").select(taskColumns).eq("user_id", user.id).order("created_at", { ascending: false });
	if (error) {
		res.status(500).json({ error: "Unable to load your tasks." });
		return;
	}
	res.json({ tasks: (data ?? []).map(toTask).filter((task) => task !== null) });
};
var startContributorTask = async (req, res) => {
	const user = await getUser$1(req, res);
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
	const serviceSupabase = serviceClient$3(res);
	if (!serviceSupabase) return;
	const { data: approvedDevice, error: deviceError } = await serviceSupabase.from("payment_requests").select("id").eq("user_id", user.id).eq("status", "Approved").order("created_at", { ascending: false }).limit(1).maybeSingle();
	if (deviceError) {
		res.status(500).json({ error: "Unable to verify this device." });
		return;
	}
	if (!approvedDevice) {
		res.status(403).json({ error: "Verify your device before starting this task." });
		return;
	}
	const { data, error } = await serviceSupabase.from("contributor_tasks").insert({
		user_id: user.id,
		assignment_id: assignment.id
	}).select(taskColumns).single();
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
//#endregion
//#region server/routes/referrals.ts
async function authenticatedUser(req, res) {
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
	return {
		user: data.user,
		token
	};
}
var getContributorReferrals = async (req, res) => {
	const auth = await authenticatedUser(req, res);
	if (!auth) return;
	const { user, token } = auth;
	const contributorSupabase = createAuthenticatedSupabaseClient(token);
	let service;
	const getService = () => service ??= createServiceRoleSupabaseClient();
	let { data: codeRow, error: codeError } = await contributorSupabase.from("contributor_referral_codes").select("code").eq("user_id", user.id).maybeSingle();
	if (codeError) {
		console.error("[api] Unable to load referral code.", codeError);
		res.status(500).json({ error: "Unable to load referral information." });
		return;
	}
	if (!codeRow) {
		const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
		let insertError;
		try {
			({error: insertError} = await getService().from("contributor_referral_codes").insert({
				user_id: user.id,
				code
			}));
		} catch (serviceError) {
			console.error("[api] Unable to provision referral code.", serviceError);
			res.status(503).json({ error: "Referral data is unavailable." });
			return;
		}
		if (insertError && insertError.code !== "23505") {
			console.error("[api] Unable to create referral code.", insertError);
			res.status(500).json({ error: "Unable to create referral information." });
			return;
		}
		const result = await contributorSupabase.from("contributor_referral_codes").select("code").eq("user_id", user.id).single();
		codeRow = result.data;
		if (result.error || !codeRow) {
			res.status(500).json({ error: "Unable to load referral information." });
			return;
		}
	}
	const { data: referrals, error } = await contributorSupabase.from("contributor_referrals").select("id, referred_user_id, status, created_at, reward_transaction_id").eq("referrer_user_id", user.id).order("created_at", { ascending: false });
	if (error) {
		console.error("[api] Unable to load referrals.", error);
		res.status(500).json({ error: "Unable to load referral history." });
		return;
	}
	const transactionIds = (referrals ?? []).map((referral) => referral.reward_transaction_id).filter((id) => Boolean(id));
	const rewardByReferral = /* @__PURE__ */ new Map();
	if (transactionIds.length) {
		const { data: transactions, error: transactionError } = await contributorSupabase.from("balance_transactions").select("id, user_id, amount, type").in("id", transactionIds).eq("user_id", user.id).eq("type", "Added");
		if (transactionError) {
			console.error("[api] Unable to load referral reward transactions.", transactionError);
			res.status(500).json({ error: "Unable to load referral history." });
			return;
		}
		for (const transaction of transactions ?? []) rewardByReferral.set(transaction.id, Number(transaction.amount));
	}
	const relatedIds = new Set((referrals ?? []).map((referral) => referral.referred_user_id));
	const names = /* @__PURE__ */ new Map();
	let page = 1;
	while (names.size < relatedIds.size) {
		let usersResult;
		try {
			usersResult = await getService().auth.admin.listUsers({
				page,
				perPage: 100
			});
		} catch (serviceError) {
			console.error("[api] Unable to load referred contributor names.", serviceError);
			res.status(503).json({ error: "Referral data is unavailable." });
			return;
		}
		const { data: users, error: usersError } = usersResult;
		if (usersError) {
			console.error("[api] Unable to load referred contributor names.", usersError);
			res.status(500).json({ error: "Unable to load referral history." });
			return;
		}
		for (const entry of users.users) {
			if (!relatedIds.has(entry.id)) continue;
			names.set(entry.id, typeof entry.user_metadata?.full_name === "string" && entry.user_metadata.full_name.trim() ? entry.user_metadata.full_name.trim() : "Contributor");
		}
		if (users.users.length < 100) break;
		page++;
	}
	const history = (referrals ?? []).map((referral) => ({
		id: referral.id,
		referredContributor: names.get(referral.referred_user_id) ?? "Contributor",
		date: referral.created_at,
		status: referral.status,
		reward: referral.reward_transaction_id ? rewardByReferral.get(referral.reward_transaction_id) ?? null : null
	}));
	res.setHeader("Cache-Control", "no-store");
	res.json({
		code: codeRow.code,
		total: history.length,
		successful: history.filter((referral) => referral.status === "Successful").length,
		pending: history.filter((referral) => referral.status === "Pending").length,
		history
	});
};
//#endregion
//#region server/routes/legal.ts
var policySchema = z.object({
	id: z.string().uuid().optional(),
	key: z.enum([
		"terms",
		"privacy",
		"cookies",
		"contributor-agreement"
	]),
	title: z.string().trim().min(1).max(160),
	content: z.string().trim().min(1).max(5e4),
	version: z.number().int().positive(),
	effectiveDate: z.string().date(),
	isPublished: z.boolean(),
	acknowledgementRequired: z.boolean()
}).strict();
async function authorize$1(req, res, admin = false) {
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
	if (admin && data.user.app_metadata?.role !== "admin") {
		res.status(403).json({ error: "Administrator access required" });
		return null;
	}
	return data.user;
}
function serviceClient$2(res) {
	try {
		return createServiceRoleSupabaseClient();
	} catch {
		res.status(503).json({ error: "Legal data is unavailable." });
		return null;
	}
}
var listPublicPolicies = async (_req, res) => {
	const service = serviceClient$2(res);
	if (!service) return;
	const { data, error } = await service.from("legal_policies").select("id, policy_key, title, content, version, effective_date, acknowledgement_required, created_at").eq("is_published", true).order("version", { ascending: false });
	if (error) {
		console.error("[api] Unable to load published policies.", error);
		res.status(503).json({ error: "Published policies are unavailable." });
		return;
	}
	const latest = /* @__PURE__ */ new Map();
	for (const policy of data ?? []) if (!latest.has(policy.policy_key)) latest.set(policy.policy_key, policy);
	res.setHeader("Cache-Control", "no-store");
	res.json({ policies: [...latest.values()] });
};
var listAdminPolicies = async (req, res) => {
	if (!await authorize$1(req, res, true)) return;
	const service = serviceClient$2(res);
	if (!service) return;
	const { data, error } = await service.from("legal_policies").select("id, policy_key, title, content, version, effective_date, is_published, acknowledgement_required, created_at").order("policy_key").order("version", { ascending: false });
	if (error) {
		console.error("[api] Unable to load legal policies.", error);
		res.status(503).json({ error: "Legal policies are unavailable." });
		return;
	}
	res.json({ policies: data ?? [] });
};
var saveAdminPolicy = async (req, res) => {
	const admin = await authorize$1(req, res, true);
	if (!admin) return;
	const parsed = policySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid policy." });
		return;
	}
	const service = serviceClient$2(res);
	if (!service) return;
	const policy = parsed.data;
	if (policy.id) {
		const { data: current, error: currentError } = await service.from("legal_policies").select("id, is_published, policy_key, version").eq("id", policy.id).maybeSingle();
		if (currentError || !current) {
			res.status(404).json({ error: "Policy version not found." });
			return;
		}
		if (current.is_published) {
			res.status(409).json({ error: "Published versions cannot be edited. Create a new version instead." });
			return;
		}
		if (policy.key !== current.policy_key || policy.version !== current.version) {
			res.status(400).json({ error: "A draft policy's type and version cannot be changed." });
			return;
		}
		const { error } = await service.from("legal_policies").update({
			title: policy.title,
			content: policy.content,
			effective_date: policy.effectiveDate,
			is_published: policy.isPublished,
			acknowledgement_required: policy.acknowledgementRequired
		}).eq("id", policy.id);
		if (error) {
			console.error("[api] Unable to update legal policy.", error);
			res.status(500).json({ error: "Unable to save policy." });
			return;
		}
		res.json({ success: true });
		return;
	}
	const { data: prior, error: priorError } = await service.from("legal_policies").select("version").eq("policy_key", policy.key).order("version", { ascending: false }).limit(1);
	if (priorError) {
		res.status(500).json({ error: "Unable to verify policy version." });
		return;
	}
	if (policy.version !== (prior?.[0]?.version ?? 0) + 1) {
		res.status(409).json({ error: "Create the next sequential version for this policy." });
		return;
	}
	const { error } = await service.from("legal_policies").insert({
		policy_key: policy.key,
		title: policy.title,
		content: policy.content,
		version: policy.version,
		effective_date: policy.effectiveDate,
		is_published: policy.isPublished,
		acknowledgement_required: policy.acknowledgementRequired,
		created_by: admin.id
	});
	if (error) {
		console.error("[api] Unable to create legal policy version.", error);
		res.status(500).json({ error: "Unable to create policy version." });
		return;
	}
	res.status(201).json({ success: true });
};
var listMyPolicyAcknowledgements = async (req, res) => {
	const user = await authorize$1(req, res);
	if (!user) return;
	const service = serviceClient$2(res);
	if (!service) return;
	const [{ data: policies, error: policiesError }, { data: acknowledgements, error: ackError }] = await Promise.all([service.from("legal_policies").select("id, policy_key, title, content, version, effective_date, acknowledgement_required").eq("is_published", true).eq("acknowledgement_required", true).order("version", { ascending: false }), service.from("legal_policy_acknowledgements").select("policy_id, acknowledged_at").eq("user_id", user.id)]);
	if (policiesError || ackError) {
		console.error("[api] Unable to load policy acknowledgements.", policiesError ?? ackError);
		res.status(503).json({ error: "Policy acknowledgement status is unavailable." });
		return;
	}
	const latest = /* @__PURE__ */ new Map();
	for (const policy of policies ?? []) if (!latest.has(policy.policy_key)) latest.set(policy.policy_key, policy);
	res.json({
		policies: [...latest.values()],
		acknowledgements: acknowledgements ?? []
	});
};
var acknowledgePolicy = async (req, res) => {
	const user = await authorize$1(req, res);
	if (!user) return;
	const policyId = typeof req.body?.policyId === "string" ? req.body.policyId : "";
	if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(policyId)) {
		res.status(400).json({ error: "A valid policy version is required." });
		return;
	}
	const service = serviceClient$2(res);
	if (!service) return;
	const { data: policy, error: policyError } = await service.from("legal_policies").select("id").eq("id", policyId).eq("is_published", true).eq("acknowledgement_required", true).maybeSingle();
	if (policyError || !policy) {
		res.status(404).json({ error: "Required published policy not found." });
		return;
	}
	const { error } = await service.from("legal_policy_acknowledgements").insert({
		user_id: user.id,
		policy_id: policy.id
	});
	if (error?.code === "23505") {
		res.status(409).json({ error: "This policy version has already been acknowledged." });
		return;
	}
	if (error) {
		console.error("[api] Unable to save policy acknowledgement.", error);
		res.status(500).json({ error: "Unable to save acknowledgement." });
		return;
	}
	res.status(201).json({ success: true });
};
//#endregion
//#region server/lib/email-templates.ts
function sanitizeEmailHtml(html) {
	const allowedTags = /* @__PURE__ */ new Set([
		"p",
		"br",
		"strong",
		"b",
		"em",
		"i",
		"u",
		"ul",
		"ol",
		"li",
		"a",
		"h1",
		"h2",
		"h3",
		"blockquote"
	]);
	return html.replace(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>/gi, (tag) => {
		const match = tag.match(/^<\s*(\/?)\s*([a-z0-9]+)([^>]*)>$/i);
		if (!match) return "";
		const [, closing, rawName, rawAttributes] = match;
		const name = rawName.toLowerCase();
		if (!allowedTags.has(name)) return "";
		if (closing) return name === "br" ? "" : `</${name}>`;
		if (name === "br") return "<br>";
		if (name !== "a") return `<${name}>`;
		const hrefMatch = rawAttributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
		const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "";
		if (!href || !isSafeEmailLink(href)) return "<a>";
		return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">`;
	});
}
function isSafeEmailLink(value) {
	if (/^[\u0000-\u0020]/.test(value)) return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return value.startsWith("/") && !value.startsWith("//");
	}
}
function escapeHtml(value) {
	return value.replace(/[&<>"']/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	})[character]);
}
//#endregion
//#region server/routes/site-settings.ts
var templateKeys = [
	"new_application",
	"application_status_changed",
	"device_request_received",
	"device_approved",
	"device_rejected",
	"new_message",
	"withdrawal_status",
	"interview_status",
	"admin_notification"
];
var seoSchema = z.object({
	siteTitle: z.string().trim().min(1).max(120),
	metaDescription: z.string().trim().max(320),
	defaultKeywords: z.string().trim().max(500),
	ogTitle: z.string().trim().max(120),
	ogDescription: z.string().trim().max(320),
	ogImage: z.string().trim().max(2048).refine((value) => !value || isHttpUrl(value), "Use an HTTP or HTTPS image URL."),
	twitterTitle: z.string().trim().max(120),
	twitterDescription: z.string().trim().max(320),
	canonicalUrl: z.string().trim().max(2048).refine((value) => !value || isRootUrl(value), "Use the production site root URL without a path, query, or fragment."),
	allowIndexing: z.boolean()
}).strict();
var siteSchema = z.object({
	siteName: z.string().trim().min(1).max(120),
	siteDescription: z.string().trim().max(500),
	supportEmail: z.string().trim().max(254).refine((value) => !value || z.email().safeParse(value).success, "Enter a valid support email."),
	contactInformation: z.string().trim().max(1e3),
	defaultNotificationPreferences: z.object({
		emailEnabled: z.boolean(),
		inAppEnabled: z.boolean()
	}).strict(),
	maintenanceMode: z.boolean(),
	maintenanceMessage: z.string().trim().min(1).max(500)
}).strict();
var templateSchema = z.object({
	key: z.enum(templateKeys),
	label: z.string().trim().min(1).max(100),
	subject: z.string().trim().max(200).refine((value) => !/[\r\n]/.test(value), "Subject cannot contain line breaks."),
	body: z.string().max(1e4),
	html: z.string().max(2e4),
	enabled: z.boolean()
}).strict();
var templatesSchema = z.array(templateSchema).length(templateKeys.length).superRefine((templates, context) => {
	if (new Set(templates.map((template) => template.key)).size !== templateKeys.length) context.addIssue({
		code: "custom",
		message: "All email templates must be present exactly once."
	});
});
function isHttpUrl(value) {
	try {
		return ["http:", "https:"].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}
function isRootUrl(value) {
	if (!isHttpUrl(value)) return false;
	const url = new URL(value);
	return url.pathname === "/" && !url.search && !url.hash;
}
async function authorizeAdmin(req, res) {
	const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!token) {
		res.status(401).json({ error: "Authentication required" });
		return false;
	}
	const { data, error } = await supabase.auth.getUser(token);
	if (error || !data.user) {
		res.status(401).json({ error: "Authentication required" });
		return false;
	}
	if (data.user.app_metadata?.role !== "admin") {
		res.status(403).json({ error: "Administrator access required" });
		return false;
	}
	return true;
}
function databaseClient(res) {
	try {
		return createServiceRoleSupabaseClient();
	} catch {
		res.status(503).json({ error: "Site settings are not configured on the server." });
		return null;
	}
}
var getPublicSiteSettings = async (_req, res) => {
	const service = databaseClient(res);
	if (!service) return;
	const { data, error } = await service.from("site_admin_settings").select("seo, site").eq("id", true).maybeSingle();
	if (error || !data) {
		res.status(503).json({ error: "Site settings are unavailable." });
		return;
	}
	const site = data.site;
	res.setHeader("Cache-Control", "no-store");
	res.json({
		seo: data.seo,
		site: {
			siteName: site.siteName,
			siteDescription: site.siteDescription,
			supportEmail: site.supportEmail,
			contactInformation: site.contactInformation,
			maintenanceMode: site.maintenanceMode,
			maintenanceMessage: site.maintenanceMessage
		}
	});
};
var getAdminSiteSettings = async (req, res) => {
	if (!await authorizeAdmin(req, res)) return;
	const service = databaseClient(res);
	if (!service) return;
	const [settingsResult, templatesResult] = await Promise.all([service.from("site_admin_settings").select("seo, site").eq("id", true).maybeSingle(), service.from("site_email_templates").select("key, label, subject, body, html, enabled").order("key")]);
	if (settingsResult.error || !settingsResult.data || templatesResult.error || !templatesResult.data) {
		res.status(503).json({ error: "Site settings are unavailable. Apply the site admin settings migration and try again." });
		return;
	}
	res.json({
		seo: settingsResult.data.seo,
		site: settingsResult.data.site,
		templates: templatesResult.data
	});
};
var updateAdminSiteSettings = async (req, res) => {
	if (!await authorizeAdmin(req, res)) return;
	const section = req.params.section;
	const schema = section === "seo" ? seoSchema : section === "site" ? siteSchema : section === "templates" ? templatesSchema : null;
	if (!schema) {
		res.status(404).json({ error: "Unknown settings section." });
		return;
	}
	const parsed = schema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." });
		return;
	}
	const service = databaseClient(res);
	if (!service) return;
	const now = (/* @__PURE__ */ new Date()).toISOString();
	let result;
	if (section === "templates") result = await service.from("site_email_templates").upsert(parsed.data.map((template) => ({
		...template,
		html: sanitizeEmailHtml(template.html),
		updated_at: now
	})), { onConflict: "key" });
	else if (section === "seo") result = await service.from("site_admin_settings").update({
		seo: parsed.data,
		updated_at: now
	}).eq("id", true);
	else result = await service.from("site_admin_settings").update({
		site: parsed.data,
		updated_at: now
	}).eq("id", true);
	if (result.error) {
		console.error("[api] Failed to save site settings", result.error);
		res.status(500).json({ error: "Unable to save site settings." });
		return;
	}
	res.json({ success: true });
};
//#endregion
//#region server/lib/interview-access.ts
async function getInterviewStatus(user) {
	const { data: interview, error } = await createServiceRoleSupabaseClient().from("interview_submissions").select("status").eq("user_id", user.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
	if (error) throw error;
	return interview?.status ?? null;
}
var requireInterviewApproval = async (req, res, next) => {
	if (req.method === "GET" && req.originalUrl.split("?")[0] === "/api/vendor-conversations/support") {
		next();
		return;
	}
	const authorization = req.headers.authorization ?? "";
	const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : void 0;
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
		res.status(403).json({
			error: "Complete the interview and receive administrator approval before accessing contributor tools.",
			interviewRequired: true
		});
	} catch (verificationError) {
		console.error("[api] Unable to verify contributor interview approval.", verificationError);
		res.status(503).json({ error: "Unable to verify contributor access right now." });
	}
};
//#endregion
//#region server/routes/interviews.ts
var questionSchema = z.object({ prompt: z.string().trim().min(5).max(1e3) });
var answerSchema = z.object({
	questionId: z.string().uuid(),
	prompt: z.string().min(5).max(1e3),
	answer: z.string().trim().max(5e3)
});
var questionColumns = "id, prompt, position, created_at";
var submissionColumns = "id, user_id, applicant_name, email, status, answers, submitted_at, reviewed_at, interview_mode";
var QUESTION_DURATION_MS = 6e4;
var sessionColumns = "id, user_id, status, answers, interview_mode, current_question_index, question_start_times, session_expired_at, submitted_at";
function sessionPayload(session, now = Date.now()) {
	const index = session.current_question_index ?? 0;
	const startedAt = Date.parse(session.question_start_times[index] ?? "");
	return {
		id: session.id,
		index,
		answers: session.answers ?? [],
		deadlineAt: Number.isFinite(startedAt) ? startedAt + QUESTION_DURATION_MS : null,
		serverNow: now
	};
}
async function loadQuestions(service) {
	return service.from("interview_questions").select("id, prompt, position, created_at").order("position").order("created_at");
}
function answerForQuestion(answers, question, answer) {
	return [...answers.filter((existing) => existing.questionId !== question.id), {
		questionId: question.id,
		question: question.prompt,
		answer
	}];
}
function sessionResponse(session) {
	const now = Date.now();
	return {
		session: {
			...sessionPayload(session, now),
			status: session.status
		},
		serverNow: now
	};
}
async function getUser(req, res) {
	const authorization = req.headers.authorization ?? "";
	const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : void 0;
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
async function getAdminUser(req, res) {
	const user = await getUser(req, res);
	if (!user) return null;
	if (user.app_metadata?.role !== "admin") {
		res.status(403).json({ error: "Administrator access required" });
		return null;
	}
	return user;
}
function serviceClient$1(res) {
	try {
		return createServiceRoleSupabaseClient();
	} catch {
		res.status(503).json({ error: "Interview data is not configured." });
		return null;
	}
}
var getInterviewAccess = async (req, res) => {
	const user = await getUser(req, res);
	if (!user) return;
	if (user.app_metadata?.role === "admin") {
		res.json({
			status: "Approved",
			isAdmin: true
		});
		return;
	}
	try {
		res.json({ status: await getInterviewStatus(user) });
	} catch (error) {
		console.error("[api] Unable to verify interview approval.", error);
		res.status(500).json({ error: "Unable to verify interview approval." });
	}
};
var getInterviewQuestions = async (req, res) => {
	if (!await getUser(req, res)) return;
	const service = serviceClient$1(res);
	if (!service) return;
	const { data, error } = await loadQuestions(service);
	if (error) {
		console.error("[api] Unable to load interview questions.", error);
		res.status(500).json({ error: "Unable to load interview questions." });
		return;
	}
	res.json({ questions: data ?? [] });
};
var startInterview = async (req, res) => {
	const user = await getUser(req, res);
	if (!user) return;
	if (req.body?.mode !== "text") {
		res.status(400).json({ error: "Choose Text-Based Interview to begin the timed interview." });
		return;
	}
	const service = serviceClient$1(res);
	if (!service) return;
	const [{ data: activeAttempt, error: activeError }, { data: submission, error: submissionError }, { data: questions, error: questionError }] = await Promise.all([
		service.from("interview_submissions").select(sessionColumns).eq("user_id", user.id).is("submitted_at", null).is("session_expired_at", null).maybeSingle(),
		service.from("interview_submissions").select("id, status").eq("user_id", user.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
		loadQuestions(service)
	]);
	if (activeError || submissionError || questionError) {
		const migrationRequired = [
			activeError,
			submissionError,
			questionError
		].some((error) => error?.code === "42703");
		res.status(migrationRequired ? 503 : 500).json({ error: migrationRequired ? "The interview database update must be applied before timed interviews can start." : "Unable to start your interview." });
		return;
	}
	if (submission) {
		res.status(409).json({ error: "Your interview has already been submitted." });
		return;
	}
	if (!questions?.length) {
		res.status(409).json({ error: "Interview questions are not available yet." });
		return;
	}
	if (activeAttempt) {
		const { error } = await service.from("interview_submissions").update({ session_expired_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", activeAttempt.id).is("submitted_at", null).is("session_expired_at", null);
		if (error) {
			res.status(500).json({ error: "Unable to archive the previous interview attempt." });
			return;
		}
	}
	const applicantName = typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim() ? user.user_metadata.full_name.trim().slice(0, 200) : (user.email ?? "Applicant").slice(0, 200);
	const { data, error } = await service.from("interview_submissions").insert({
		user_id: user.id,
		applicant_name: applicantName,
		email: user.email ?? "",
		status: "Under Review",
		answers: [],
		interview_mode: "text",
		current_question_index: 0,
		question_start_times: [],
		submitted_at: null
	}).select(sessionColumns).single();
	if (error) {
		if (error.code === "23505") {
			res.status(409).json({ error: "A new interview attempt has already started. Reload to continue." });
			return;
		}
		console.error("[api] Unable to start interview session.", error);
		res.status(500).json({ error: "Unable to start your interview." });
		return;
	}
	res.status(201).json(sessionResponse(data));
};
var startInterviewQuestion = async (req, res) => {
	const user = await getUser(req, res);
	if (!user) return;
	const parsed = z.object({
		sessionId: z.string().uuid(),
		questionIndex: z.number().int().min(0).max(99)
	}).safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: "The interview question could not be started." });
		return;
	}
	const service = serviceClient$1(res);
	if (!service) return;
	const { data, error } = await service.rpc("start_interview_question", {
		p_session_id: parsed.data.sessionId,
		p_user_id: user.id,
		p_question_index: parsed.data.questionIndex
	});
	const session = Array.isArray(data) ? data[0] : data;
	if (error || !session || session.user_id !== user.id) {
		res.status(error ? 500 : 409).json({ error: "This interview question is no longer active." });
		return;
	}
	res.json(sessionResponse(session));
};
var saveInterviewAnswer = async (req, res) => {
	const user = await getUser(req, res);
	if (!user) return;
	const parsed = z.object({
		sessionId: z.string().uuid(),
		questionId: z.string().uuid(),
		answer: z.string().max(5e3),
		targetIndex: z.number().int().min(0).max(99)
	}).safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: "Your answer could not be saved." });
		return;
	}
	const service = serviceClient$1(res);
	if (!service) return;
	const { data: sessionData, error: sessionError } = await service.from("interview_submissions").select(sessionColumns).eq("id", parsed.data.sessionId).eq("user_id", user.id).maybeSingle();
	if (sessionError || !sessionData) {
		res.status(sessionError ? 500 : 409).json({ error: "Start your interview before saving an answer." });
		return;
	}
	const session = sessionData;
	if (session.session_expired_at || session.submitted_at !== null) {
		res.status(409).json({ error: "This interview session is no longer active." });
		return;
	}
	const { data: questions, error: questionError } = await loadQuestions(service);
	if (questionError || !questions?.length) {
		res.status(500).json({ error: "Unable to verify the current interview question." });
		return;
	}
	const currentIndex = session.current_question_index ?? 0;
	const targetIndex = parsed.data.targetIndex;
	const currentStartedAt = Date.parse(session.question_start_times[currentIndex] ?? "");
	if (!Number.isFinite(currentStartedAt)) {
		res.status(409).json({ error: "The question timer has not started yet." });
		return;
	}
	if (targetIndex < 0 || targetIndex >= questions.length || targetIndex !== currentIndex && targetIndex !== currentIndex + 1 || questions[currentIndex]?.id !== parsed.data.questionId) {
		res.status(409).json({ error: "The interview question changed. Reload to continue." });
		return;
	}
	if (targetIndex === currentIndex + 1 && Date.now() < currentStartedAt + QUESTION_DURATION_MS) {
		res.status(409).json({ error: "This question is still in progress." });
		return;
	}
	const answers = answerForQuestion(session.answers ?? [], questions[currentIndex], parsed.data.answer);
	const timestamps = [...session.question_start_times ?? []];
	const { data, error } = await service.from("interview_submissions").update({
		answers,
		current_question_index: targetIndex,
		question_start_times: timestamps
	}).eq("id", session.id).eq("current_question_index", currentIndex).is("submitted_at", null).is("session_expired_at", null).select(sessionColumns).single();
	if (error) {
		res.status(500).json({ error: "Unable to save your answer." });
		return;
	}
	const updatedSession = data;
	res.json(sessionResponse(updatedSession));
};
var getMyInterview = async (req, res) => {
	const user = await getUser(req, res);
	if (!user) return;
	const service = serviceClient$1(res);
	if (!service) return;
	const { data, error } = await service.from("interview_submissions").select("id, status, answers, submitted_at, reviewed_at, interview_mode").eq("user_id", user.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
	if (error?.code === "42703") {
		const { data: legacySubmission, error: legacyError } = await service.from("interview_submissions").select("id, status, answers, submitted_at, reviewed_at").eq("user_id", user.id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
		if (legacyError) {
			res.status(500).json({ error: "Unable to load your interview." });
			return;
		}
		res.json({
			submission: legacySubmission?.submitted_at ? legacySubmission : null,
			schemaUpgradeRequired: true
		});
		return;
	}
	if (error) {
		console.error("[api] Unable to load interview submission.", error);
		res.status(500).json({ error: "Unable to load your interview." });
		return;
	}
	res.json({ submission: data ?? null });
};
var submitInterview = async (req, res) => {
	const user = await getUser(req, res);
	if (!user) return;
	const parsed = z.object({
		sessionId: z.string().uuid(),
		answers: z.array(answerSchema).min(1).max(100)
	}).safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: "Please answer every interview question." });
		return;
	}
	const service = serviceClient$1(res);
	if (!service) return;
	const { data: sessionData, error: sessionError } = await service.from("interview_submissions").select(sessionColumns).eq("id", parsed.data.sessionId).eq("user_id", user.id).maybeSingle();
	if (sessionError || !sessionData) {
		res.status(sessionError ? 500 : 409).json({ error: "Start your interview before submitting answers." });
		return;
	}
	const session = sessionData;
	if (session.session_expired_at || session.submitted_at !== null) {
		res.status(409).json({ error: "This interview session is no longer active." });
		return;
	}
	const { data: questions, error: questionError } = await loadQuestions(service);
	if (questionError) {
		res.status(500).json({ error: "Unable to load interview questions." });
		return;
	}
	const currentIndex = session.current_question_index ?? 0;
	const currentStartedAt = Date.parse(session.question_start_times[currentIndex] ?? "");
	if (!Number.isFinite(currentStartedAt)) {
		res.status(409).json({ error: "The interview question timing could not be verified." });
		return;
	}
	if (Date.now() < currentStartedAt + QUESTION_DURATION_MS) {
		res.status(409).json({ error: "Please complete the full time for this question before submitting." });
		return;
	}
	if (currentIndex !== (questions?.length ?? 0) - 1 || !questions?.length || parsed.data.answers.length !== questions.length || new Set(parsed.data.answers.map((answer) => answer.questionId)).size !== questions.length) {
		res.status(400).json({ error: "Please answer every current interview question." });
		return;
	}
	const questionById = new Map(questions.map((question) => [question.id, question.prompt]));
	const answers = parsed.data.answers.map(({ questionId, prompt, answer }) => ({
		questionId,
		question: prompt,
		answer
	}));
	if (answers.some((answer) => questionById.get(answer.questionId) !== answer.question) || answers.some(({ questionId }) => !questionById.has(questionId))) {
		res.status(400).json({ error: "The interview questions have changed or an answer is missing." });
		return;
	}
	const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
	const { data, error } = await service.from("interview_submissions").update({
		answers,
		submitted_at: submittedAt
	}).eq("id", session.id).is("submitted_at", null).is("session_expired_at", null).select("id, status, submitted_at").single();
	if (error) {
		console.error("[api] Unable to save interview submission.", error);
		res.status(500).json({ error: "Unable to submit your interview." });
		return;
	}
	res.status(201).json({ submission: data });
};
var listAdminInterviews = async (req, res) => {
	if (!await getAdminUser(req, res)) return;
	const service = serviceClient$1(res);
	if (!service) return;
	const { data, error } = await service.from("interview_submissions").select(submissionColumns).not("submitted_at", "is", null).order("submitted_at", { ascending: false });
	if (error?.code === "42703") {
		const { data: legacySubmissions, error: legacyError } = await service.from("interview_submissions").select("id, user_id, applicant_name, email, status, answers, submitted_at, reviewed_at").not("submitted_at", "is", null).order("submitted_at", { ascending: false });
		if (legacyError) {
			res.status(500).json({ error: "Unable to load submitted interviews." });
			return;
		}
		res.json({ submissions: (legacySubmissions ?? []).map((submission) => ({
			...submission,
			interview_mode: null
		})) });
		return;
	}
	if (error) {
		res.status(500).json({ error: "Unable to load submitted interviews." });
		return;
	}
	res.json({ submissions: data ?? [] });
};
var updateInterviewStatus = async (req, res) => {
	if (!await getAdminUser(req, res)) return;
	const status = req.body?.status;
	if (status !== "Approved" && status !== "Rejected") {
		res.status(400).json({ error: "Choose Accept or Reject for this interview." });
		return;
	}
	const service = serviceClient$1(res);
	if (!service) return;
	const { data, error } = await service.from("interview_submissions").update({
		status,
		reviewed_at: (/* @__PURE__ */ new Date()).toISOString()
	}).eq("id", req.params.id).not("submitted_at", "is", null).select("id, user_id, applicant_name, status").maybeSingle();
	if (error) {
		res.status(500).json({ error: "Unable to update interview status." });
		return;
	}
	if (!data) {
		res.status(404).json({ error: "Interview submission not found." });
		return;
	}
	await notifyUser({
		userId: data.user_id,
		type: status === "Approved" ? "application_approved" : "application_rejected",
		title: `Interview ${status}`,
		message: `${data.applicant_name}'s interview has been ${status.toLowerCase()}.`,
		link: status === "Approved" ? "/dashboard" : "/interview",
		relatedId: data.id
	});
	res.json({
		id: data.id,
		status
	});
};
var createInterviewQuestion = async (req, res) => {
	if (!await getAdminUser(req, res)) return;
	const parsed = questionSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: "Question text must be between 5 and 1000 characters." });
		return;
	}
	const service = serviceClient$1(res);
	if (!service) return;
	const { data: last, error: orderError } = await service.from("interview_questions").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
	if (orderError) {
		res.status(500).json({ error: "Unable to prepare a new interview question." });
		return;
	}
	const { data, error } = await service.from("interview_questions").insert({
		prompt: parsed.data.prompt,
		position: (last?.position ?? -1) + 1
	}).select(questionColumns).single();
	if (error) {
		res.status(500).json({ error: "Unable to create interview question." });
		return;
	}
	res.status(201).json({ question: data });
};
var updateInterviewQuestion = async (req, res) => {
	if (!await getAdminUser(req, res)) return;
	const parsed = questionSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: "Question text must be between 5 and 1000 characters." });
		return;
	}
	const service = serviceClient$1(res);
	if (!service) return;
	const { data, error } = await service.from("interview_questions").update({ prompt: parsed.data.prompt }).eq("id", req.params.id).select(questionColumns).maybeSingle();
	if (error) {
		res.status(500).json({ error: "Unable to update interview question." });
		return;
	}
	if (!data) {
		res.status(404).json({ error: "Interview question not found." });
		return;
	}
	res.json({ question: data });
};
var deleteInterviewQuestion = async (req, res) => {
	if (!await getAdminUser(req, res)) return;
	const service = serviceClient$1(res);
	if (!service) return;
	const { data, error } = await service.from("interview_questions").delete().eq("id", req.params.id).select("id").maybeSingle();
	if (error) {
		res.status(500).json({ error: "Unable to delete interview question." });
		return;
	}
	if (!data) {
		res.status(404).json({ error: "Interview question not found." });
		return;
	}
	res.json({ id: data.id });
};
var reorderInterviewQuestions = async (req, res) => {
	if (!await getAdminUser(req, res)) return;
	const ids = z.array(z.string().uuid()).min(1).max(100).safeParse(req.body?.ids);
	if (!ids.success || new Set(ids.data).size !== ids.data.length) {
		res.status(400).json({ error: "Provide each interview question exactly once, in the desired order." });
		return;
	}
	const service = serviceClient$1(res);
	if (!service) return;
	const { data: questions, error } = await service.from("interview_questions").select("id");
	if (error) {
		res.status(500).json({ error: "Unable to verify interview question order." });
		return;
	}
	if (questions?.length !== ids.data.length || ids.data.some((id) => !questions.some((question) => question.id === id))) {
		res.status(400).json({ error: "The question list changed. Reload and try again." });
		return;
	}
	if ((await Promise.all(ids.data.map((id, position) => service.from("interview_questions").update({ position }).eq("id", id)))).some(({ error: updateError }) => updateError)) {
		res.status(500).json({ error: "Unable to save interview question order." });
		return;
	}
	res.json({ success: true });
};
//#endregion
//#region server/routes/contributor-earnings.ts
var getContributorEarnings = async (req, res) => {
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
	try {
		const { data, error } = await createServiceRoleSupabaseClient().from("contributor_earnings").select("available_balance, pending_earnings, total_withdrawn, payment_gateway_configured").eq("user_id", auth.user.id).maybeSingle();
		if (error) throw error;
		res.json({
			availableBalance: Number(data?.available_balance) || 0,
			pendingEarnings: Number(data?.pending_earnings) || 0,
			totalWithdrawn: Number(data?.total_withdrawn) || 0,
			paymentGatewayConfigured: Boolean(data?.payment_gateway_configured)
		});
	} catch (error) {
		console.error("[api] Unable to load contributor earnings.", error);
		res.status(500).json({ error: "Unable to load contributor earnings." });
	}
};
//#endregion
//#region server/routes/kyc.ts
var identitySchema = z.object({
	fullName: z.string().trim().max(160).optional().default(""),
	dateOfBirth: z.string().max(40).optional().default(""),
	documentNumber: z.string().trim().max(100).optional().default(""),
	expiryDate: z.string().max(40).optional().default("")
}).strict();
var acceptedTypeSchema = z.object({
	id: z.string().min(1).max(50),
	label: z.string().trim().min(1).max(100),
	instructions: z.string().trim().max(500)
}).strict();
var instructionsSchema = z.object({
	instructions: z.string().trim().min(1).max(5e3),
	acceptedIdTypes: z.array(acceptedTypeSchema).min(1).max(20)
}).strict();
var draftSchema = z.object({
	consent: z.boolean().optional(),
	idType: z.string().max(50).optional(),
	idImagePath: z.string().max(500).nullable().optional(),
	selfieImagePath: z.string().max(500).nullable().optional(),
	identityInformation: identitySchema.optional(),
	qualityFlags: z.array(z.string().max(200)).max(20).optional(),
	confirmations: z.object({
		idPhotoReadable: z.boolean(),
		selfieCentered: z.boolean()
	}).strict().optional()
}).strict();
async function authorize(req, res, admin = false) {
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
	return {
		user: data.user,
		isAdmin
	};
}
function serviceClient(res) {
	try {
		return createServiceRoleSupabaseClient();
	} catch {
		res.status(503).json({ error: "KYC service is unavailable." });
		return null;
	}
}
async function hasApprovedDevice(service, userId) {
	const { data, error } = await service.from("payment_requests").select("status").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
	if (error) throw error;
	return data?.status === "Approved";
}
async function latestSubmission(service, userId) {
	const { data, error } = await service.from("contributor_kyc_submissions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
	if (error) throw error;
	return data;
}
async function signedFile(service, path) {
	if (!path) return null;
	const { data, error } = await service.storage.from("contributor-kyc").createSignedUrl(path, 300);
	if (error) throw error;
	return data.signedUrl;
}
var getKycInstructions = async (req, res) => {
	const auth = await authorize(req, res);
	if (!auth) return;
	const service = serviceClient(res);
	if (!service) return;
	try {
		if (!await hasApprovedDevice(service, auth.user.id)) {
			res.status(403).json({ error: "KYC becomes available after device approval." });
			return;
		}
	} catch {
		res.status(503).json({ error: "KYC instructions are unavailable." });
		return;
	}
	const { data, error } = await service.from("contributor_kyc_instructions").select("instructions, accepted_id_types, updated_at").eq("id", true).single();
	if (error || !data) {
		res.status(503).json({ error: "KYC instructions are unavailable." });
		return;
	}
	res.setHeader("Cache-Control", "no-store");
	res.json({
		instructions: data.instructions,
		acceptedIdTypes: data.accepted_id_types,
		updatedAt: data.updated_at
	});
};
var getMyKycStatus = async (req, res) => {
	const auth = await authorize(req, res);
	if (!auth) return;
	const service = serviceClient(res);
	if (!service) return;
	try {
		if (!await hasApprovedDevice(service, auth.user.id)) {
			res.setHeader("Cache-Control", "no-store");
			res.json({
				deviceApproved: false,
				status: null,
				rejectionReason: null
			});
			return;
		}
		const { data, error } = await service.from("contributor_kyc_submissions").select("status, rejection_reason").eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
		if (error) throw error;
		res.setHeader("Cache-Control", "no-store");
		res.json({
			deviceApproved: true,
			status: data?.status ?? null,
			rejectionReason: data?.rejection_reason ?? null
		});
	} catch {
		res.status(503).json({ error: "KYC status is unavailable." });
	}
};
var getMyKyc = async (req, res) => {
	const auth = await authorize(req, res);
	if (!auth) return;
	const service = serviceClient(res);
	if (!service) return;
	try {
		const deviceApproved = await hasApprovedDevice(service, auth.user.id);
		if (!deviceApproved) {
			res.setHeader("Cache-Control", "no-store");
			res.json({
				deviceApproved: false,
				submission: null
			});
			return;
		}
		const submission = await latestSubmission(service, auth.user.id);
		if (submission) {
			submission.id_image_url = await signedFile(service, submission.id_image_path);
			submission.selfie_image_url = await signedFile(service, submission.selfie_image_path);
		}
		res.setHeader("Cache-Control", "no-store");
		res.json({
			deviceApproved,
			submission
		});
	} catch {
		res.status(503).json({ error: "KYC status is unavailable." });
	}
};
var createKycDraft = async (req, res) => {
	const auth = await authorize(req, res);
	if (!auth) return;
	const service = serviceClient(res);
	if (!service) return;
	try {
		if (!await hasApprovedDevice(service, auth.user.id)) {
			res.status(403).json({ error: "KYC becomes available after device approval." });
			return;
		}
		const current = await latestSubmission(service, auth.user.id);
		if (current?.status === "approved" || current?.status === "pending" || current?.status === "draft") {
			res.status(409).json({ error: "An active KYC submission already exists." });
			return;
		}
		const { data, error } = await service.from("contributor_kyc_submissions").insert({ user_id: auth.user.id }).select("id, status, created_at").single();
		if (error || !data) throw error;
		res.status(201).json({ submission: data });
	} catch {
		res.status(503).json({ error: "Unable to start KYC." });
	}
};
var uploadKycFile = async (req, res) => {
	const auth = await authorize(req, res);
	if (!auth) return;
	const { id, kind } = req.params;
	if (typeof id !== "string" || !z.string().uuid().safeParse(id).success || typeof kind !== "string" || !["id", "selfie"].includes(kind)) {
		res.status(400).json({ error: "Invalid KYC file request." });
		return;
	}
	const contentType = req.headers["content-type"];
	if (!contentType || ![
		"image/jpeg",
		"image/png",
		"image/webp"
	].includes(contentType)) {
		res.status(415).json({ error: "Upload a JPEG, PNG, or WebP image." });
		return;
	}
	const service = serviceClient(res);
	if (!service) return;
	try {
		if (!await hasApprovedDevice(service, auth.user.id)) {
			res.status(403).json({ error: "KYC becomes available after device approval." });
			return;
		}
		const { data: draft, error: draftError } = await service.from("contributor_kyc_submissions").select("id").eq("id", id).eq("user_id", auth.user.id).eq("status", "draft").maybeSingle();
		if (draftError || !draft) {
			res.status(404).json({ error: "KYC draft not found." });
			return;
		}
		const chunks = [];
		let size = 0;
		for await (const chunk of req) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buffer.length;
			if (size > 10485760) {
				res.status(413).json({ error: "Images must be 10 MB or smaller." });
				return;
			}
			chunks.push(buffer);
		}
		const file = Buffer.concat(chunks);
		if (!(contentType === "image/jpeg" ? file[0] === 255 && file[1] === 216 : contentType === "image/png" ? file.subarray(0, 8).equals(Buffer.from([
			137,
			80,
			78,
			71,
			13,
			10,
			26,
			10
		])) : file.subarray(0, 4).toString() === "RIFF" && file.subarray(8, 12).toString() === "WEBP") || file.length < 1024) {
			res.status(400).json({ error: "The uploaded file is not a valid image." });
			return;
		}
		const path = `${auth.user.id}/${id}/${kind}-${crypto.randomUUID()}.${contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp"}`;
		const { error } = await service.storage.from("contributor-kyc").upload(path, file, {
			contentType,
			upsert: false
		});
		if (error) throw error;
		res.status(201).json({ path });
	} catch {
		res.status(500).json({ error: "Unable to securely store the image." });
	}
};
var saveKycDraft = async (req, res) => {
	const auth = await authorize(req, res);
	if (!auth) return;
	const submissionId = req.params.id;
	if (!z.string().uuid().safeParse(submissionId).success) {
		res.status(400).json({ error: "Invalid KYC submission." });
		return;
	}
	const parsed = draftSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ error: "Check the information and try again." });
		return;
	}
	const service = serviceClient(res);
	if (!service) return;
	try {
		const { data: submission, error: readError } = await service.from("contributor_kyc_submissions").select("id, status, user_id").eq("id", submissionId).eq("user_id", auth.user.id).maybeSingle();
		if (readError || !submission) {
			res.status(404).json({ error: "KYC draft not found." });
			return;
		}
		if (submission.status !== "draft") {
			res.status(409).json({ error: "This submission can no longer be edited." });
			return;
		}
		const update = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
		const values = parsed.data;
		if (values.consent !== void 0) update.consent_at = values.consent ? (/* @__PURE__ */ new Date()).toISOString() : null;
		if (values.idType !== void 0) update.id_type = values.idType;
		for (const [key, value] of [["idImagePath", values.idImagePath], ["selfieImagePath", values.selfieImagePath]]) if (value !== void 0) {
			if (value !== null && !new RegExp(`^${auth.user.id}/${submissionId}/${key === "idImagePath" ? "id" : "selfie"}-[0-9a-f-]{36}\\.(jpg|png|webp)$`, "i").test(value)) {
				res.status(400).json({ error: "Invalid uploaded file reference." });
				return;
			}
			update[key === "idImagePath" ? "id_image_path" : "selfie_image_path"] = value;
		}
		if (values.identityInformation) update.identity_information = values.identityInformation;
		if (values.qualityFlags) update.quality_flags = values.qualityFlags;
		if (values.confirmations) update.capture_confirmations = values.confirmations;
		const { error } = await service.from("contributor_kyc_submissions").update(update).eq("id", submissionId).eq("user_id", auth.user.id).eq("status", "draft");
		if (error) throw error;
		res.json({ success: true });
	} catch {
		res.status(500).json({ error: "Unable to save KYC progress." });
	}
};
var submitKyc = async (req, res) => {
	const auth = await authorize(req, res);
	if (!auth) return;
	const submissionId = typeof req.body?.submissionId === "string" ? req.body.submissionId : "";
	if (!z.string().uuid().safeParse(submissionId).success) {
		res.status(400).json({ error: "Invalid KYC submission." });
		return;
	}
	const service = serviceClient(res);
	if (!service) return;
	try {
		if (!await hasApprovedDevice(service, auth.user.id)) {
			res.status(403).json({ error: "KYC becomes available after device approval." });
			return;
		}
		const [{ data: submission, error: readError }, { data: settings, error: settingsError }] = await Promise.all([service.from("contributor_kyc_submissions").select("*").eq("id", submissionId).eq("user_id", auth.user.id).eq("status", "draft").maybeSingle(), service.from("contributor_kyc_instructions").select("accepted_id_types").eq("id", true).single()]);
		if (readError || settingsError || !submission || !settings) {
			res.status(409).json({ error: "KYC draft is unavailable. Refresh and try again." });
			return;
		}
		const accepted = settings.accepted_id_types;
		const information = identitySchema.safeParse(submission.identity_information);
		const confirmations = submission.capture_confirmations;
		const [idFile, selfieFile] = await Promise.all([service.storage.from("contributor-kyc").download(submission.id_image_path), service.storage.from("contributor-kyc").download(submission.selfie_image_path)]);
		if (idFile.error || selfieFile.error || !idFile.data || !selfieFile.data) {
			res.status(400).json({ error: "A required image is missing. Re-upload the image and try again." });
			return;
		}
		const birthDate = information.success && /^\d{4}-\d{2}-\d{2}$/.test(information.data.dateOfBirth) ? /* @__PURE__ */ new Date(`${information.data.dateOfBirth}T00:00:00.000Z`) : null;
		const validBirthDate = Boolean(birthDate && !Number.isNaN(birthDate.getTime()) && birthDate.toISOString().slice(0, 10) === information.data.dateOfBirth && birthDate.getTime() <= Date.now());
		if (!submission.consent_at || !accepted.some((entry) => entry.id === submission.id_type) || !submission.id_image_path || !submission.selfie_image_path || !confirmations.idPhotoReadable || !confirmations.selfieCentered || !information.success || !information.data.fullName || !validBirthDate || !information.data.documentNumber) {
			res.status(400).json({ error: "Complete consent, upload both images, select an accepted ID, and confirm all required information before submitting." });
			return;
		}
		const { data: updated, error } = await service.from("contributor_kyc_submissions").update({
			status: "pending",
			submitted_at: (/* @__PURE__ */ new Date()).toISOString(),
			updated_at: (/* @__PURE__ */ new Date()).toISOString()
		}).eq("id", submissionId).eq("user_id", auth.user.id).eq("status", "draft").select("id").maybeSingle();
		if (error || !updated) throw error;
		await notifyAdmins({
			type: "new_kyc_submission",
			title: "New KYC submission",
			message: "A contributor submitted identity documents for review.",
			link: "/admin/kyc",
			relatedId: updated.id
		});
		res.json({ status: "pending" });
	} catch {
		res.status(500).json({ error: "Unable to submit KYC." });
	}
};
var listAdminKyc = async (req, res) => {
	if (!await authorize(req, res, true)) return;
	const service = serviceClient(res);
	if (!service) return;
	const status = typeof req.query.status === "string" && [
		"pending",
		"approved",
		"rejected"
	].includes(req.query.status) ? req.query.status : void 0;
	const { data, error } = await service.from("contributor_kyc_submissions").select("id, user_id, status, id_type, submitted_at, reviewed_at, created_at").neq("status", "draft").order("submitted_at", { ascending: false });
	if (error) {
		res.status(503).json({ error: "KYC submissions are unavailable." });
		return;
	}
	const rows = (data ?? []).filter((row) => !status || row.status === status);
	const submissions = await Promise.all(rows.map(async (row) => {
		const { data: user } = await service.auth.admin.getUserById(row.user_id);
		const profile = user?.user.user_metadata ?? {};
		const displayName = typeof profile.full_name === "string" ? profile.full_name : typeof profile.name === "string" ? profile.name : "Contributor";
		return {
			...row,
			contributor_name: displayName,
			contributor_email: user?.user.email ?? ""
		};
	}));
	const counts = (data ?? []).reduce((result, row) => {
		if (row.status === "pending") result.pending++;
		if (row.status === "approved") result.approved++;
		if (row.status === "rejected") result.rejected++;
		return result;
	}, {
		pending: 0,
		approved: 0,
		rejected: 0
	});
	res.setHeader("Cache-Control", "no-store");
	res.json({
		counts,
		submissions
	});
};
var getAdminKyc = async (req, res) => {
	if (!await authorize(req, res, true)) return;
	const id = req.params.id;
	if (!z.string().uuid().safeParse(id).success) {
		res.status(400).json({ error: "Invalid KYC submission." });
		return;
	}
	const service = serviceClient(res);
	if (!service) return;
	const { data, error } = await service.from("contributor_kyc_submissions").select("*").eq("id", id).maybeSingle();
	if (error || !data || data.status === "draft") {
		res.status(404).json({ error: "KYC submission not found." });
		return;
	}
	try {
		const [{ data: user }, idImageUrl, selfieImageUrl] = await Promise.all([
			service.auth.admin.getUserById(data.user_id),
			signedFile(service, data.id_image_path),
			signedFile(service, data.selfie_image_path)
		]);
		res.setHeader("Cache-Control", "no-store");
		res.json({ submission: {
			...data,
			contributor_email: user?.user.email ?? "",
			id_image_url: idImageUrl,
			selfie_image_url: selfieImageUrl
		} });
	} catch {
		res.status(503).json({ error: "KYC review material is unavailable." });
	}
};
var reviewKyc = async (req, res) => {
	const auth = await authorize(req, res, true);
	if (!auth) return;
	const parsed = z.object({
		status: z.enum(["approved", "rejected"]),
		rejectionReason: z.string().trim().max(2e3).optional()
	}).strict().safeParse(req.body);
	if (!parsed.success || parsed.data.status === "rejected" && !parsed.data.rejectionReason) {
		res.status(400).json({ error: "A rejection reason is required." });
		return;
	}
	const service = serviceClient(res);
	if (!service) return;
	const { data: current, error: readError } = await service.from("contributor_kyc_submissions").select("id, user_id, status").eq("id", req.params.id).maybeSingle();
	if (readError || !current || current.status !== "pending") {
		res.status(404).json({ error: "Pending KYC submission not found." });
		return;
	}
	const { data: updated, error } = await service.from("contributor_kyc_submissions").update({
		status: parsed.data.status,
		rejection_reason: parsed.data.status === "rejected" ? parsed.data.rejectionReason : null,
		reviewed_at: (/* @__PURE__ */ new Date()).toISOString(),
		reviewed_by: auth.user.id,
		updated_at: (/* @__PURE__ */ new Date()).toISOString()
	}).eq("id", current.id).eq("status", "pending").select("id").maybeSingle();
	if (error || !updated) {
		res.status(409).json({ error: "This KYC submission has already been reviewed." });
		return;
	}
	const approved = parsed.data.status === "approved";
	await notifyUser({
		userId: current.user_id,
		type: approved ? "kyc_approved" : "kyc_rejected",
		title: approved ? "KYC approved" : "KYC needs changes",
		message: approved ? "Your identity documents have been approved." : `Your KYC submission was rejected: ${parsed.data.rejectionReason}`,
		link: "/dashboard",
		relatedId: current.id
	});
	res.json({ status: parsed.data.status });
};
var getAdminKycInstructions = async (req, res) => {
	if (!await authorize(req, res, true)) return;
	const service = serviceClient(res);
	if (!service) return;
	const { data, error } = await service.from("contributor_kyc_instructions").select("instructions, accepted_id_types, updated_at").eq("id", true).single();
	if (error || !data) {
		res.status(503).json({ error: "KYC instructions are unavailable." });
		return;
	}
	res.json({
		instructions: data.instructions,
		acceptedIdTypes: data.accepted_id_types,
		updatedAt: data.updated_at
	});
};
var saveAdminKycInstructions = async (req, res) => {
	const auth = await authorize(req, res, true);
	if (!auth) return;
	const parsed = instructionsSchema.safeParse(req.body);
	if (!parsed.success || new Set(parsed.data.acceptedIdTypes.map((type) => type.id)).size !== parsed.data.acceptedIdTypes.length) {
		res.status(400).json({ error: "Provide valid instructions and unique accepted ID types." });
		return;
	}
	const service = serviceClient(res);
	if (!service) return;
	const { error } = await service.from("contributor_kyc_instructions").upsert({
		id: true,
		instructions: parsed.data.instructions,
		accepted_id_types: parsed.data.acceptedIdTypes,
		updated_at: (/* @__PURE__ */ new Date()).toISOString(),
		updated_by: auth.user.id
	});
	if (error) {
		res.status(500).json({ error: "Unable to save KYC instructions." });
		return;
	}
	res.json({ success: true });
};
//#endregion
//#region server/index.ts
function createServer() {
	const app = express();
	app.use(cors());
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));
	app.get("/health", (_req, res) => {
		res.json({ status: "ok" });
	});
	app.get("/api/ping", (_req, res) => {
		const ping = process.env.PING_MESSAGE ?? "ping";
		res.json({ message: ping });
	});
	app.get("/api/program/status", handleProgramStatus);
	app.get("/api/site/settings", getPublicSiteSettings);
	app.get("/api/admin/site-settings", getAdminSiteSettings);
	app.put("/api/admin/site-settings/:section", updateAdminSiteSettings);
	app.get("/robots.txt", (_req, res) => {
		res.type("text/plain").send("User-agent: *\nAllow: /\nDisallow: /login\nDisallow: /dashboard\nDisallow: /trusted-vendor\nDisallow: /interview\nDisallow: /admin\nDisallow: /api\n\nSitemap: https://workforcecontributors.netlify.app/sitemap.xml\n");
	});
	app.get("/sitemap.xml", (_req, res) => {
		const origin = "https://workforcecontributors.netlify.app";
		const paths = [
			"/",
			"/how-it-works",
			"/payments",
			"/success-stories",
			"/faq",
			"/contact",
			"/apply",
			"/legal"
		];
		const lastmod = "2026-10-03";
		const urls = paths.map((path) => `<url><loc>${xmlEscape(new URL(path, origin).toString())}</loc><lastmod>${lastmod}</lastmod></url>`).join("");
		res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
	});
	app.use("/api/contributor", requireInterviewApproval);
	app.use("/api/kyc", requireInterviewApproval);
	app.use("/api/payment-requests", requireInterviewApproval);
	app.use("/api/vendor-conversations", requireInterviewApproval);
	app.use("/api/notifications", requireInterviewApproval);
	app.post("/api/payment-requests", createPaymentRequest);
	app.get("/api/payment-requests", listPaymentRequests);
	app.patch("/api/admin/payment-requests/:id/status", updatePaymentRequestStatus);
	app.delete("/api/admin/payment-requests/:id", deletePaymentRequest);
	app.get("/api/admin/dashboard-stats", getAdminDashboardStats);
	app.get("/api/admin/review-counts", getAdminReviewCounts);
	app.get("/api/admin/users", listAdminUsers);
	app.post("/api/admin/users", createAdminUser);
	app.get("/api/admin/users/:id/overview", getAdminContributorOverview);
	app.get("/api/admin/users/:id", getAdminUserDetails);
	app.patch("/api/admin/users/:id/status", updateAdminUserStatus);
	app.delete("/api/admin/users/:id", deleteAdminUser);
	app.get("/api/admin/users/:id/balance", getUserBalance);
	app.post("/api/admin/users/:id/balance/add", addUserBalance);
	app.post("/api/admin/users/:id/balance/remove", removeUserBalance);
	app.get("/api/admin/users/:id/balance/transactions", listBalanceTransactions);
	app.get("/api/contributor/referrals", getContributorReferrals);
	app.get("/api/legal/policies", listPublicPolicies);
	app.get("/api/legal/acknowledgements", listMyPolicyAcknowledgements);
	app.post("/api/legal/acknowledgements", acknowledgePolicy);
	app.get("/api/admin/legal/policies", listAdminPolicies);
	app.post("/api/admin/legal/policies", saveAdminPolicy);
	app.post("/api/applications/mirror", mirrorApplication);
	app.get("/api/applications/me", getMyApplication);
	app.get("/api/interview/access", getInterviewAccess);
	app.get("/api/interview/questions", getInterviewQuestions);
	app.get("/api/interview/me", getMyInterview);
	app.post("/api/interview/sessions", startInterview);
	app.post("/api/interview/sessions/question", startInterviewQuestion);
	app.patch("/api/interview/sessions/answer", saveInterviewAnswer);
	app.post("/api/interview/submissions", submitInterview);
	app.get("/api/admin/interviews", listAdminInterviews);
	app.patch("/api/admin/interviews/:id/status", updateInterviewStatus);
	app.post("/api/admin/interview-questions", createInterviewQuestion);
	app.put("/api/admin/interview-questions/order", reorderInterviewQuestions);
	app.patch("/api/admin/interview-questions/:id", updateInterviewQuestion);
	app.delete("/api/admin/interview-questions/:id", deleteInterviewQuestion);
	app.get("/api/contributor/earnings", getContributorEarnings);
	app.get("/api/kyc/instructions", getKycInstructions);
	app.get("/api/kyc/me", getMyKyc);
	app.get("/api/kyc/status", getMyKycStatus);
	app.post("/api/kyc/drafts", createKycDraft);
	app.patch("/api/kyc/drafts/:id", saveKycDraft);
	app.post("/api/kyc/drafts/:id/files/:kind", uploadKycFile);
	app.post("/api/kyc/submit", submitKyc);
	app.get("/api/admin/kyc", listAdminKyc);
	app.get("/api/admin/kyc/instructions", getAdminKycInstructions);
	app.put("/api/admin/kyc/instructions", saveAdminKycInstructions);
	app.get("/api/admin/kyc/:id", getAdminKyc);
	app.patch("/api/admin/kyc/:id/review", reviewKyc);
	app.get("/api/admin/applications", listAdminApplications);
	app.get("/api/admin/applications/:id", getAdminApplicationDetails);
	app.patch("/api/admin/applications/:id/status", updateAdminApplicationStatus);
	app.delete("/api/admin/applications/:id", deleteAdminApplication);
	app.patch("/api/admin/applications/:id/verification", updateAdminApplicationVerification);
	app.post("/api/vendor-conversations", createOrGetConversation);
	app.get("/api/vendor-conversations", listConversations);
	app.get("/api/vendor-conversations/support", getOrCreateSupportConversation);
	app.get("/api/vendor-conversations/:id", getConversation);
	app.delete("/api/admin/vendor-conversations/:id", deleteAdminConversation);
	app.post("/api/vendor-conversations/:id/messages", sendMessage);
	app.patch("/api/vendor-conversations/:id/read", markConversationRead);
	app.post("/api/admin/support-conversations", adminCreateSupportConversation);
	app.get("/api/notifications", listNotifications);
	app.patch("/api/notifications/:id/read", markNotificationRead);
	app.patch("/api/notifications/read-all", markAllNotificationsRead);
	app.get("/api/contributor/tasks", listContributorTasks);
	app.post("/api/contributor/tasks", startContributorTask);
	return app;
}
function xmlEscape(value) {
	return value.replace(/[&<>"']/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&apos;"
	})[character]);
}
//#endregion
//#region server/node-build.ts
var app = createServer();
var port = process.env.PORT || 3e3;
var __dirname = import.meta.dirname;
var distPath = path.join(__dirname, "../spa");
app.use(express.static(distPath));
app.get("/{*splat}", (req, res) => {
	if (req.path.startsWith("/api/") || req.path.startsWith("/health")) return res.status(404).json({ error: "API endpoint not found" });
	res.sendFile(path.join(distPath, "index.html"));
});
app.listen(port, () => {
	console.log(`🚀 Fusion Starter server running on port ${port}`);
	console.log(`📱 Frontend: http://localhost:${port}`);
	console.log(`🔧 API: http://localhost:${port}/api`);
});
process.on("SIGTERM", () => {
	console.log("🛑 Received SIGTERM, shutting down gracefully");
	process.exit(0);
});
process.on("SIGINT", () => {
	console.log("🛑 Received SIGINT, shutting down gracefully");
	process.exit(0);
});
//#endregion
export {};

//# sourceMappingURL=node-build.mjs.map