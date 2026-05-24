import type {
  Account,
  Budget,
  Category,
  CreateAccountBody,
  CreateBudgetBody,
  CreateCategoryBody,
  CreateRecurringBody,
  CreateTransactionBody,
  DashboardSummary,
  RecurringTransaction,
  Transaction,
  User,
} from '@suzanne-lite/shared';

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
  createUser: (body: { name: string }) => http<User>('/users', { method: 'POST', body: JSON.stringify(body) }),
  accounts: (userId: number) => http<Account[]>(`/users/${userId}/accounts`),
  createAccount: (userId: number, body: CreateAccountBody) => http<Account>(`/users/${userId}/accounts`, { method: 'POST', body: JSON.stringify(body) }),
  deleteAccount: (id: number) => http<{ deleted: boolean }>(`/accounts/${id}`, { method: 'DELETE' }),
  categories: (userId: number) => http<Category[]>(`/users/${userId}/categories`),
  createCategory: (userId: number, body: CreateCategoryBody) => http<Category>(`/users/${userId}/categories`, { method: 'POST', body: JSON.stringify(body) }),
  deleteCategory: (id: number) => http<{ deleted: boolean }>(`/categories/${id}`, { method: 'DELETE' }),
  transactions: (userId: number, month?: string) => http<Transaction[]>(`/users/${userId}/transactions${month ? `?month=${month}` : ''}`),
  dashboard: (userId: number, month: string) => http<DashboardSummary>(`/users/${userId}/dashboard?month=${month}`),
  createTransaction: (userId: number, body: CreateTransactionBody) => http<Transaction>(`/users/${userId}/transactions`, { method: 'POST', body: JSON.stringify(body) }),
  deleteTransaction: (id: number) => http<{ deleted: boolean }>(`/transactions/${id}`, { method: 'DELETE' }),
  budgets: (userId: number, month?: string) => http<Budget[]>(`/users/${userId}/budgets${month ? `?month=${month}` : ''}`),
  setBudget: (userId: number, body: CreateBudgetBody) => http<Budget>(`/users/${userId}/budgets`, { method: 'POST', body: JSON.stringify(body) }),
  deleteBudget: (id: number) => http<{ deleted: boolean }>(`/budgets/${id}`, { method: 'DELETE' }),
  recurring: (userId: number) => http<RecurringTransaction[]>(`/users/${userId}/recurring-transactions`),
  createRecurring: (userId: number, body: CreateRecurringBody) => http<RecurringTransaction>(`/users/${userId}/recurring-transactions`, { method: 'POST', body: JSON.stringify(body) }),
  deleteRecurring: (id: number) => http<{ deleted: boolean }>(`/recurring-transactions/${id}`, { method: 'DELETE' }),
  generateRecurring: (userId: number) => http<{ generated: number }>(`/users/${userId}/recurring-transactions/generate`, { method: 'POST' }),
};
