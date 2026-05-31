import type {
  Account,
  AccountSnapshot,
  AiChatResponse,
  AiConfirmResponse,
  AiPendingAction,
  Budget,
  CategoryRule,
  Category,
  CreateAccountBody,
  CreateAccountSnapshotBody,
  CreateBudgetBody,
  CreateCategoryRuleBody,
  CreateCategoryBody,
  CreateInstitutionBody,
  CreateRecurringBody,
  CreateSavingsGoalBody,
  CreateTagBody,
  CreateTransactionBody,
  DashboardSummary,
  Institution,
  RecurringTransaction,
  SavingsGoal,
  SearchResult,
  StatisticsSummary,
  Tag,
  Transaction,
  User,
  WealthHistoryPoint,
} from '@suzanne-lite/shared';

import { authHeaders, notifyUnauthorized } from './authToken.js';

const API_BASE = '/api';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized();
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json() as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return await res.json() as T;
}

export interface AiHealthStatus {
  configured: boolean;
  model: string;
  baseUrl: string;
  provider: string;
  source?: string;
  ok?: boolean;
  error?: { kind: string; message: string; detail: string };
}

export interface AiSettings {
  configured: boolean;
  has_key: boolean;
  model: string;
  base_url: string;
  provider: string;
  source: string;
}

export type AiStreamEvent =
  | { kind: 'token'; text: string }
  | { kind: 'tool_start'; id: string; name: string; args: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean; pendingAction?: AiPendingAction; preview?: string }
  | { kind: 'done'; answer: string; pendingActions: AiPendingAction[] }
  | { kind: 'error'; error: { kind: string; message: string; detail: string } };

export interface SnapshotSuggestion {
  account_id: number;
  suggested_balance: number;
  last_snapshot_date: string | null;
  last_snapshot_balance: number | null;
  delta: number;
}

export type AiChatHistoryMessage = { role: 'user' | 'assistant'; content: string };

export const api = {
  users: () => http<User[]>('/users'),
  createUser: (body: { name: string }) => http<User>('/users', { method: 'POST', body: JSON.stringify(body) }),
  deleteUser: (id: number) => http<{ deleted: boolean }>(`/users/${id}`, { method: 'DELETE' }),
  accounts: (userId: number) => http<Account[]>(`/users/${userId}/accounts`),
  createAccount: (userId: number, body: CreateAccountBody) => http<Account>(`/users/${userId}/accounts`, { method: 'POST', body: JSON.stringify(body) }),
  updateAccount: (userId: number, id: number, body: Partial<CreateAccountBody>) => http<Account>(`/users/${userId}/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAccount: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/accounts/${id}`, { method: 'DELETE' }),
  institutions: (userId: number) => http<Institution[]>(`/users/${userId}/institutions`),
  createInstitution: (userId: number, body: CreateInstitutionBody) => http<Institution>(`/users/${userId}/institutions`, { method: 'POST', body: JSON.stringify(body) }),
  updateInstitution: (userId: number, id: number, body: CreateInstitutionBody) => http<Institution>(`/users/${userId}/institutions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteInstitution: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/institutions/${id}`, { method: 'DELETE' }),
  categories: (userId: number) => http<Category[]>(`/users/${userId}/categories`),
  createCategory: (userId: number, body: CreateCategoryBody) => http<Category>(`/users/${userId}/categories`, { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (userId: number, id: number, body: Partial<CreateCategoryBody>) => http<Category>(`/users/${userId}/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCategory: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/categories/${id}`, { method: 'DELETE' }),
  transactions: (userId: number, month?: string, issue?: 'unassigned_account') => {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (issue) params.set('issue', issue);
    const query = params.toString();
    return http<Transaction[]>(`/users/${userId}/transactions${query ? `?${query}` : ''}`);
  },
  dashboard: (userId: number, month: string, currency = 'EUR') =>
    http<DashboardSummary>(`/users/${userId}/dashboard?month=${month}&currency=${encodeURIComponent(currency)}`),
  wealthHistory: (userId: number, range: string, granularity: string, currency = 'EUR', from?: string, to?: string) => {
    const params = new URLSearchParams({ range, granularity, currency });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return http<WealthHistoryPoint[]>(`/users/${userId}/wealth-history?${params.toString()}`);
  },
  createTransaction: (userId: number, body: CreateTransactionBody) => http<Transaction>(`/users/${userId}/transactions`, { method: 'POST', body: JSON.stringify(body) }),
  updateTransaction: (userId: number, id: number, body: Partial<CreateTransactionBody>) => http<Transaction>(`/users/${userId}/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  linkTransactionRecurring: (userId: number, id: number, body: { recurring_transaction_id: number | null; sync_description?: boolean; sync_amount?: boolean; sync_category_account?: boolean }) =>
    http<Transaction>(`/users/${userId}/transactions/${id}/link-recurring`, { method: 'POST', body: JSON.stringify(body) }),
  deleteTransaction: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/transactions/${id}`, { method: 'DELETE' }),
  budgets: (userId: number, month?: string) => http<Budget[]>(`/users/${userId}/budgets${month ? `?month=${month}` : ''}`),
  setBudget: (userId: number, body: CreateBudgetBody) => http<Budget>(`/users/${userId}/budgets`, { method: 'POST', body: JSON.stringify(body) }),
  deleteBudget: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/budgets/${id}`, { method: 'DELETE' }),
  recurring: (userId: number) => http<RecurringTransaction[]>(`/users/${userId}/recurring-transactions`),
  createRecurring: (userId: number, body: CreateRecurringBody) => http<RecurringTransaction>(`/users/${userId}/recurring-transactions`, { method: 'POST', body: JSON.stringify(body) }),
  updateRecurring: (userId: number, id: number, body: Partial<CreateRecurringBody>) =>
    http<RecurringTransaction>(`/users/${userId}/recurring-transactions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRecurring: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/recurring-transactions/${id}`, { method: 'DELETE' }),
  generateRecurring: (userId: number) => http<{ generated: number }>(`/users/${userId}/recurring-transactions/generate`, { method: 'POST' }),
  rules: (userId: number) => http<CategoryRule[]>(`/users/${userId}/category-rules`),
  setRule: (userId: number, body: CreateCategoryRuleBody) => http<CategoryRule>(`/users/${userId}/category-rules`, { method: 'POST', body: JSON.stringify(body) }),
  deleteRule: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/category-rules/${id}`, { method: 'DELETE' }),
  tags: (userId: number) => http<Tag[]>(`/users/${userId}/tags`),
  createTag: (userId: number, body: CreateTagBody) => http<Tag>(`/users/${userId}/tags`, { method: 'POST', body: JSON.stringify(body) }),
  updateTag: (userId: number, id: number, body: Partial<CreateTagBody>) => http<Tag>(`/users/${userId}/tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTag: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/tags/${id}`, { method: 'DELETE' }),
  goals: (userId: number) => http<SavingsGoal[]>(`/users/${userId}/savings-goals`),
  createGoal: (userId: number, body: CreateSavingsGoalBody) => http<SavingsGoal>(`/users/${userId}/savings-goals`, { method: 'POST', body: JSON.stringify(body) }),
  updateGoal: (userId: number, id: number, body: Partial<CreateSavingsGoalBody>) => http<SavingsGoal>(`/users/${userId}/savings-goals/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  contributeGoal: (userId: number, id: number, body: { amount: number; date: string; source_account_id?: number | null; description?: string | null }) =>
    http<{ goal: SavingsGoal; transaction_id: number | null }>(`/users/${userId}/savings-goals/${id}/contribute`, { method: 'POST', body: JSON.stringify(body) }),
  deleteGoal: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/savings-goals/${id}`, { method: 'DELETE' }),
  snapshots: (userId: number) => http<AccountSnapshot[]>(`/users/${userId}/account-snapshots`),
  snapshotSuggestions: (userId: number, date: string) =>
    http<SnapshotSuggestion[]>(`/users/${userId}/account-snapshots/suggestions?date=${encodeURIComponent(date)}`),
  setSnapshot: (userId: number, body: CreateAccountSnapshotBody) => http<AccountSnapshot>(`/users/${userId}/account-snapshots`, { method: 'POST', body: JSON.stringify(body) }),
  setSnapshotBatch: (userId: number, body: { date: string; balances: Array<{ account_id: number; balance: number }> }) =>
    http<{ saved: number; created: number; updated: number }>(`/users/${userId}/account-snapshots/batch`, { method: 'POST', body: JSON.stringify(body) }),
  deleteSnapshot: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/account-snapshots/${id}`, { method: 'DELETE' }),
  importCsv: (userId: number, body: { csv: string; account_id?: number | null; date_format?: string; mapping?: { date: string; amount: string; description?: string | null; type?: string | null } }) => http<{ imported: number; skipped: number }>(`/users/${userId}/import.csv`, { method: 'POST', body: JSON.stringify(body) }),
  exportJsonUrl: (userId: number) => `${API_BASE}/users/${userId}/export.json`,
  exportCsvUrl: (userId: number) => `${API_BASE}/users/${userId}/transactions.csv`,
  exportSelection: async (userId: number, body: { entities: string[]; from?: string | null; to?: string | null }) => {
    const res = await fetch(`${API_BASE}/users/${userId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 401) notifyUnauthorized();
      let message = `HTTP ${res.status}`;
      try { const data = await res.json() as { error?: string }; if (data?.error) message = data.error; } catch { /* keep */ }
      throw new Error(message);
    }
    return await res.blob();
  },
  importJson: (userId: number, payload: unknown) =>
    http<{ institutions: { created: number; reused: number }; accounts: { created: number; reused: number }; categories: { created: number; reused: number }; rules: { created: number; reused: number }; transactions: { created: number }; budgets: { created: number; updated: number }; recurring: { created: number }; goals: { created: number; reused: number }; snapshots: { created: number; updated: number } }>(
      `/users/${userId}/import.json`, { method: 'POST', body: JSON.stringify({ payload }) }),
  search: (userId: number, q: string) => http<SearchResult[]>(`/users/${userId}/search?q=${encodeURIComponent(q)}`),
  statistics: (userId: number, range: string, currency: string, excludeUncategorized: boolean, from?: string | null, to?: string | null) => {
    const params = new URLSearchParams({ range, currency, exclude_uncategorized: String(excludeUncategorized) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return http<StatisticsSummary>(`/users/${userId}/statistics?${params.toString()}`);
  },
  aiHealth: () => http<AiHealthStatus>('/ai/health'),
  aiSettings: () => http<AiSettings>('/settings/ai'),
  updateAiSettings: (body: { api_key?: string | null; model?: string | null; base_url?: string | null; provider?: string | null }) =>
    http<AiSettings>('/settings/ai', { method: 'PUT', body: JSON.stringify(body) }),
  aiChat: (userId: number, body: { message: string; month: string; currency: string; history?: AiChatHistoryMessage[] }) =>
    http<AiChatResponse>(`/users/${userId}/ai/chat`, { method: 'POST', body: JSON.stringify(body) }),
  aiChatStream: async function* (
    userId: number,
    body: { message: string; month: string; currency: string; history?: AiChatHistoryMessage[] },
    signal?: AbortSignal,
  ): AsyncGenerator<AiStreamEvent> {
    const res = await fetch(`${API_BASE}/users/${userId}/ai/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      if (res.status === 401) notifyUnauthorized();
      let message = `HTTP ${res.status}`;
      try { const data = await res.json() as { error?: string }; if (data?.error) message = data.error; } catch { /* keep */ }
      throw new Error(message);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lineEnd: number;
      while ((lineEnd = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, lineEnd).replace(/\r$/, '');
        buffer = buffer.slice(lineEnd + 1);
        if (!rawLine.startsWith('data:')) continue;
        const data = rawLine.slice(5).trim();
        if (!data) continue;
        try { yield JSON.parse(data) as AiStreamEvent; } catch { /* malformed — skip */ }
      }
    }
  },
  confirmAiAction: (userId: number, action: AiPendingAction) =>
    http<AiConfirmResponse>(`/users/${userId}/ai/confirm`, { method: 'POST', body: JSON.stringify({ action }) }),
};
