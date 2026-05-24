import type { Account, Category, DashboardSummary, Transaction, User } from '@suzanne-lite/shared';

const API_BASE = '/api';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json() as T;
}

export const api = {
  users: () => http<User[]>('/users'),
  accounts: (userId: number) => http<Account[]>(`/users/${userId}/accounts`),
  categories: (userId: number) => http<Category[]>(`/users/${userId}/categories`),
  transactions: (userId: number, month?: string) => http<Transaction[]>(`/users/${userId}/transactions${month ? `?month=${month}` : ''}`),
  dashboard: (userId: number, month: string) => http<DashboardSummary>(`/users/${userId}/dashboard?month=${month}`),
  createTransaction: (userId: number, body: unknown) => http<Transaction>(`/users/${userId}/transactions`, { method: 'POST', body: JSON.stringify(body) }),
};
