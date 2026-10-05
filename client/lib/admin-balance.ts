import type {
  AdjustBalanceInput,
  BalanceTransaction,
  UserBalance,
} from "@shared/admin-balance";
import { apiRequest } from "./api-request";

export function getUserBalance(userId: string) {
  return apiRequest<UserBalance>(`/api/admin/users/${userId}/balance`);
}

export function addUserBalance(userId: string, input: AdjustBalanceInput) {
  return apiRequest<BalanceTransaction>(`/api/admin/users/${userId}/balance/add`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function removeUserBalance(userId: string, input: AdjustBalanceInput) {
  return apiRequest<BalanceTransaction>(`/api/admin/users/${userId}/balance/remove`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listBalanceTransactions(userId: string) {
  return apiRequest<BalanceTransaction[]>(`/api/admin/users/${userId}/balance/transactions`);
}
