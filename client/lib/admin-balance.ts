import type {
  AdjustBalanceInput,
  BalanceTransaction,
  UserBalance,
} from "@shared/admin-balance";
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

export function getUserBalance(userId: string) {
  return request<UserBalance>(`/api/admin/users/${userId}/balance`);
}

export function addUserBalance(userId: string, input: AdjustBalanceInput) {
  return request<BalanceTransaction>(`/api/admin/users/${userId}/balance/add`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function removeUserBalance(userId: string, input: AdjustBalanceInput) {
  return request<BalanceTransaction>(`/api/admin/users/${userId}/balance/remove`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listBalanceTransactions(userId: string) {
  return request<BalanceTransaction[]>(`/api/admin/users/${userId}/balance/transactions`);
}
