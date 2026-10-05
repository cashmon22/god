import type {
  VendorConversation,
  VendorMessage,
  ConversationWithMessages,
  CreateConversationInput,
} from "@shared/vendor-messages";
import { apiRequest } from "./api-request";

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
