import type {
  VendorConversation,
  VendorMessage,
  ConversationWithMessages,
  CreateConversationInput,
} from "@shared/vendor-messages";
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

export function createOrGetConversation(input: CreateConversationInput) {
  return request<VendorConversation>("/api/vendor-conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getOrCreateSupportConversation() {
  return request<VendorConversation>("/api/vendor-conversations/support");
}

export function listConversations(type?: "vendor" | "support") {
  const query = type ? `?type=${type}` : "";
  return request<VendorConversation[]>(`/api/vendor-conversations${query}`);
}

export function adminCreateSupportConversation(userId: string) {
  return request<VendorConversation>("/api/admin/support-conversations", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function listAllUsers() {
  return request<{ users: Array<{ id: string; name: string; email: string }> }>("/api/admin/users");
}

export function getConversation(id: string) {
  return request<ConversationWithMessages>(`/api/vendor-conversations/${id}`);
}

export function deleteAdminConversation(id: string) {
  return request<{ id: string }>(`/api/admin/vendor-conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function sendMessage(conversationId: string, body: string) {
  return request<VendorMessage>(`/api/vendor-conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function markConversationRead(conversationId: string) {
  return request<{ success: boolean }>(`/api/vendor-conversations/${conversationId}/read`, {
    method: "PATCH",
  });
}
