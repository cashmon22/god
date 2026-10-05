import type {
  VendorConversation,
  VendorMessage,
  ConversationWithMessages,
  CreateConversationInput,
} from "@shared/vendor-messages";
 ai_main_10604776168c4613afcc
import { getCurrentSession } from "./supabase";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await getCurrentSession();
  if (!session) throw new Error("Your secure session has expired. Please sign in again.");

  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) {
    throw new Error(payload && typeof payload === "object" && "error" in payload ? payload.error : "Unable to complete the request.");
  }
  return payload as T;
}

import { apiRequest } from "./api-request";
 main

export function createOrGetConversation(input: CreateConversationInput) {
  return apiRequest<VendorConversation>("/api/vendor-conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getOrCreateSupportConversation() {
  return apiRequest<VendorConversation>("/api/vendor-conversations/support");
}

export function listConversations(type?: "vendor" | "support") {
  const query = type ? `?type=${type}` : "";
  return apiRequest<VendorConversation[]>(`/api/vendor-conversations${query}`);
}

export function adminCreateSupportConversation(userId: string) {
  return apiRequest<VendorConversation>("/api/admin/support-conversations", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function listAllUsers() {
  return apiRequest<{ users: Array<{ id: string; name: string; email: string }> }>("/api/admin/users");
}

export function getConversation(id: string) {
  return apiRequest<ConversationWithMessages>(`/api/vendor-conversations/${id}`);
}

export function deleteAdminConversation(id: string) {
  return apiRequest<{ id: string }>(`/api/admin/vendor-conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function sendMessage(conversationId: string, body: string) {
  return apiRequest<VendorMessage>(`/api/vendor-conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function markConversationRead(conversationId: string) {
  return apiRequest<{ success: boolean }>(`/api/vendor-conversations/${conversationId}/read`, {
    method: "PATCH",
  });
}
