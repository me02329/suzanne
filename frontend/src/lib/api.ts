import type {
  Account,
  AccountSnapshot,
  AiChatResponse,
  AiConfirmResponse,
  AiPendingAction,
  Bill,
  BillsStatusSummary,
  Budget,
  BudgetStatus,
  CategoryRule,
  Category,
  CreateAccountBody,
  CreateAccountSnapshotBody,
  CreateBillBody,
  CreateBudgetBody,
  CreateCategoryRuleBody,
  CreateCategoryBody,
  CreateInstitutionBody,
  CreateRecurringBody,
  CreateSavingsGoalBody,
  CreateTagBody,
  CreateTransactionBody,
  Alert,
  AnomalyReport,
  Attachment,
  AuditLogEntry,
  BackupImportSummary,
  BackupMeta,
  CreateAlertBody,
  CreateAttachmentBody,
  CreateHoldingBody,
  CreateHoldingOrderBody,
  CreateImportMappingBody,
  DashboardSummary,
  ImportMapping,
  ImportResult,
  StatementImportBody,
  TriggeredAlert,
  GoalContribution,
  Holding,
  HoldingsValuation,
  Institution,
  RecurringTransaction,
  SavingsGoal,
  SearchResult,
  StatisticsSummary,
  Tag,
  Transaction,
  User,
  WealthHistoryPoint,
} from '@suzanne/shared';

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

async function httpBlob(path: string, init?: RequestInit): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized();
    let message = `HTTP ${res.status}`;
    try { const data = await res.json() as { error?: string }; if (data?.error) message = data.error; } catch { /* keep */ }
    throw new Error(message);
  }
  return await res.blob();
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
  accountActivity: (userId: number, id: number, limit = 40) =>
    http<{ inflow: number; outflow: number; cleared_balance: number; uncleared_count: number; recent: Transaction[] }>(`/users/${userId}/accounts/${id}/activity?limit=${limit}`),
  createAccount: (userId: number, body: CreateAccountBody) => http<Account>(`/users/${userId}/accounts`, { method: 'POST', body: JSON.stringify(body) }),
  updateAccount: (userId: number, id: number, body: Partial<CreateAccountBody> & { archived?: boolean }) => http<Account>(`/users/${userId}/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAccount: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/accounts/${id}`, { method: 'DELETE' }),
  institutions: (userId: number) => http<Institution[]>(`/users/${userId}/institutions`),
  createInstitution: (userId: number, body: CreateInstitutionBody) => http<Institution>(`/users/${userId}/institutions`, { method: 'POST', body: JSON.stringify(body) }),
  updateInstitution: (userId: number, id: number, body: CreateInstitutionBody) => http<Institution>(`/users/${userId}/institutions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteInstitution: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/institutions/${id}`, { method: 'DELETE' }),
  categories: (userId: number) => http<Category[]>(`/users/${userId}/categories`),
  createCategory: (userId: number, body: CreateCategoryBody) => http<Category>(`/users/${userId}/categories`, { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (userId: number, id: number, body: Partial<CreateCategoryBody>) => http<Category>(`/users/${userId}/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCategory: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/categories/${id}`, { method: 'DELETE' }),
  mergeCategory: (userId: number, sourceId: number, targetCategoryId: number) =>
    http<{ merged: boolean; target_category_id: number }>(`/users/${userId}/categories/${sourceId}/merge`, { method: 'POST', body: JSON.stringify({ target_category_id: targetCategoryId }) }),
  transactions: (userId: number, month?: string, issue?: 'unassigned_account') => {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (issue) params.set('issue', issue);
    const query = params.toString();
    return http<Transaction[]>(`/users/${userId}/transactions${query ? `?${query}` : ''}`);
  },
  // Recherche ciblée (liaison de remboursement, drill-down des stats) :
  // toutes périodes par défaut, restreignable par catégorie et plage de dates.
  findTransactions: (userId: number, opts: { type?: 'expense' | 'income' | 'transfer'; q?: string; category_id?: number; from?: string; to?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts.type) params.set('type', opts.type);
    if (opts.q) params.set('q', opts.q);
    if (opts.category_id) params.set('category_id', String(opts.category_id));
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (opts.limit) params.set('limit', String(opts.limit));
    return http<Transaction[]>(`/users/${userId}/transactions?${params.toString()}`);
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
  // Édition groupée (compte / catégorie / pointage / tag) en un seul appel.
  bulkUpdateTransactions: (userId: number, body: { ids: number[]; account_id?: number | null; category_id?: number | null; cleared?: boolean; add_tag_id?: number; remove_tag_id?: number }) =>
    http<{ updated: number }>(`/users/${userId}/transactions/bulk-update`, { method: 'POST', body: JSON.stringify(body) }),
  bulkDeleteTransactions: (userId: number, ids: number[]) =>
    http<{ deleted: number }>(`/users/${userId}/transactions/bulk-delete`, { method: 'POST', body: JSON.stringify({ ids }) }),
  budgets: (userId: number, month?: string) => http<Budget[]>(`/users/${userId}/budgets${month ? `?month=${month}` : ''}`),
  budgetsStatus: (userId: number, month: string, currency: string) =>
    http<BudgetStatus[]>(`/users/${userId}/budgets/status?month=${month}&currency=${currency}`),
  setBudget: (userId: number, body: CreateBudgetBody) => http<Budget>(`/users/${userId}/budgets`, { method: 'POST', body: JSON.stringify(body) }),
  deleteBudget: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/budgets/${id}`, { method: 'DELETE' }),
  recurring: (userId: number) => http<RecurringTransaction[]>(`/users/${userId}/recurring-transactions`),
  createRecurring: (userId: number, body: CreateRecurringBody) => http<RecurringTransaction>(`/users/${userId}/recurring-transactions`, { method: 'POST', body: JSON.stringify(body) }),
  updateRecurring: (userId: number, id: number, body: Partial<CreateRecurringBody>) =>
    http<RecurringTransaction>(`/users/${userId}/recurring-transactions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRecurring: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/recurring-transactions/${id}`, { method: 'DELETE' }),
  skipRecurring: (userId: number, id: number) => http<RecurringTransaction>(`/users/${userId}/recurring-transactions/${id}/skip`, { method: 'POST' }),
  generateRecurring: (userId: number) => http<{ generated: number }>(`/users/${userId}/recurring-transactions/generate`, { method: 'POST' }),
  rules: (userId: number) => http<CategoryRule[]>(`/users/${userId}/category-rules`),
  setRule: (userId: number, body: CreateCategoryRuleBody) => http<CategoryRule>(`/users/${userId}/category-rules`, { method: 'POST', body: JSON.stringify(body) }),
  updateRule: (userId: number, id: number, body: Partial<CreateCategoryRuleBody>) => http<CategoryRule>(`/users/${userId}/category-rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRule: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/category-rules/${id}`, { method: 'DELETE' }),
  applyRules: (userId: number) => http<{ categorized: number; scanned: number }>(`/users/${userId}/category-rules/apply`, { method: 'POST' }),
  tags: (userId: number) => http<Tag[]>(`/users/${userId}/tags`),
  createTag: (userId: number, body: CreateTagBody) => http<Tag>(`/users/${userId}/tags`, { method: 'POST', body: JSON.stringify(body) }),
  updateTag: (userId: number, id: number, body: Partial<CreateTagBody>) => http<Tag>(`/users/${userId}/tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTag: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/tags/${id}`, { method: 'DELETE' }),
  goals: (userId: number) => http<SavingsGoal[]>(`/users/${userId}/savings-goals`),
  createGoal: (userId: number, body: CreateSavingsGoalBody) => http<SavingsGoal>(`/users/${userId}/savings-goals`, { method: 'POST', body: JSON.stringify(body) }),
  updateGoal: (userId: number, id: number, body: Partial<CreateSavingsGoalBody>) => http<SavingsGoal>(`/users/${userId}/savings-goals/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  contributeGoal: (userId: number, id: number, body: { amount: number; date: string; source_account_id?: number | null; description?: string | null }) =>
    http<{ goal: SavingsGoal; transaction_id: number | null }>(`/users/${userId}/savings-goals/${id}/contribute`, { method: 'POST', body: JSON.stringify(body) }),
  withdrawGoal: (userId: number, id: number, body: { amount: number; date: string; destination_account_id?: number | null; description?: string | null }) =>
    http<{ goal: SavingsGoal; transaction_id: number | null }>(`/users/${userId}/savings-goals/${id}/withdraw`, { method: 'POST', body: JSON.stringify(body) }),
  deleteGoal: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/savings-goals/${id}`, { method: 'DELETE' }),
  goalContributions: (userId: number, goalId: number) =>
    http<GoalContribution[]>(`/users/${userId}/savings-goals/${goalId}/contributions`),
  deleteGoalContribution: (userId: number, goalId: number, contributionId: number) =>
    http<{ deleted: boolean; goal: SavingsGoal }>(`/users/${userId}/savings-goals/${goalId}/contributions/${contributionId}`, { method: 'DELETE' }),
  holdings: (userId: number) => http<Holding[]>(`/users/${userId}/holdings`),
  holdingsValuation: (userId: number, currency: string) =>
    http<HoldingsValuation>(`/users/${userId}/holdings/valuation?currency=${currency}`),
  createHolding: (userId: number, body: CreateHoldingBody) =>
    http<Holding>(`/users/${userId}/holdings`, { method: 'POST', body: JSON.stringify(body) }),
  updateHolding: (userId: number, id: number, body: Partial<Omit<CreateHoldingBody, 'account_id'>>) =>
    http<Holding>(`/users/${userId}/holdings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteHolding: (userId: number, id: number) =>
    http<{ deleted: boolean }>(`/users/${userId}/holdings/${id}`, { method: 'DELETE' }),
  addHoldingOrder: (userId: number, id: number, body: CreateHoldingOrderBody) =>
    http<Holding>(`/users/${userId}/holdings/${id}/orders`, { method: 'POST', body: JSON.stringify(body) }),
  updateHoldingOrder: (userId: number, id: number, orderId: number, body: Partial<CreateHoldingOrderBody>) =>
    http<Holding>(`/users/${userId}/holdings/${id}/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteHoldingOrder: (userId: number, id: number, orderId: number) =>
    http<Holding>(`/users/${userId}/holdings/${id}/orders/${orderId}`, { method: 'DELETE' }),
  anomalies: (userId: number) => http<AnomalyReport>(`/users/${userId}/anomalies`),
  attachments: (userId: number, txId: number) => http<Attachment[]>(`/users/${userId}/transactions/${txId}/attachments`),
  uploadAttachment: (userId: number, txId: number, body: CreateAttachmentBody) =>
    http<Attachment>(`/users/${userId}/transactions/${txId}/attachments`, { method: 'POST', body: JSON.stringify(body) }),
  deleteAttachment: (userId: number, id: number) =>
    http<{ deleted: boolean }>(`/users/${userId}/attachments/${id}`, { method: 'DELETE' }),
  // Binaire d'une pièce jointe : fetch authentifié -> object URL (à révoquer après usage).
  attachmentBlobUrl: async (userId: number, id: number): Promise<string> => {
    const res = await fetch(`${API_BASE}/users/${userId}/attachments/${id}`, { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
    return URL.createObjectURL(await res.blob());
  },
  alerts: (userId: number) => http<Alert[]>(`/users/${userId}/alerts`),
  triggeredAlerts: (userId: number, currency: string, month: string) =>
    http<TriggeredAlert[]>(`/users/${userId}/alerts/triggered?currency=${currency}&month=${month}`),
  createAlert: (userId: number, body: CreateAlertBody) =>
    http<Alert>(`/users/${userId}/alerts`, { method: 'POST', body: JSON.stringify(body) }),
  updateAlert: (userId: number, id: number, body: Partial<CreateAlertBody>) =>
    http<Alert>(`/users/${userId}/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAlert: (userId: number, id: number) =>
    http<{ deleted: boolean }>(`/users/${userId}/alerts/${id}`, { method: 'DELETE' }),
  bills: (userId: number) => http<Bill[]>(`/users/${userId}/bills`),
  billsStatus: (userId: number, month: string) => http<BillsStatusSummary>(`/users/${userId}/bills/status?month=${month}`),
  createBill: (userId: number, body: CreateBillBody) => http<Bill>(`/users/${userId}/bills`, { method: 'POST', body: JSON.stringify(body) }),
  updateBill: (userId: number, id: number, body: Partial<CreateBillBody>) => http<Bill>(`/users/${userId}/bills/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteBill: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/bills/${id}`, { method: 'DELETE' }),
  linkBillMatch: (userId: number, billId: number, transactionId: number) =>
    http<{ id: number }>(`/users/${userId}/bills/${billId}/matches`, { method: 'POST', body: JSON.stringify({ transaction_id: transactionId }) }),
  unlinkBillMatch: (userId: number, billId: number, transactionId: number) =>
    http<{ deleted: boolean }>(`/users/${userId}/bills/${billId}/matches/${transactionId}`, { method: 'DELETE' }),
  snapshots: (userId: number) => http<AccountSnapshot[]>(`/users/${userId}/account-snapshots`),
  snapshotSuggestions: (userId: number, date: string) =>
    http<SnapshotSuggestion[]>(`/users/${userId}/account-snapshots/suggestions?date=${encodeURIComponent(date)}`),
  setSnapshot: (userId: number, body: CreateAccountSnapshotBody) => http<AccountSnapshot>(`/users/${userId}/account-snapshots`, { method: 'POST', body: JSON.stringify(body) }),
  setSnapshotBatch: (userId: number, body: { date: string; balances: Array<{ account_id: number; balance: number }> }) =>
    http<{ saved: number; created: number; updated: number }>(`/users/${userId}/account-snapshots/batch`, { method: 'POST', body: JSON.stringify(body) }),
  deleteSnapshot: (userId: number, id: number) => http<{ deleted: boolean }>(`/users/${userId}/account-snapshots/${id}`, { method: 'DELETE' }),
  importCsv: (userId: number, body: { csv: string; account_id?: number | null; date_format?: string; mapping?: { date: string; amount: string; description?: string | null; type?: string | null } }) =>
    http<{
      imported: number;
      skipped: number;
      duplicates_count: number;
      duplicates: Array<{ line: number; date: string; amount: number; description: string; reason: 'existing' | 'file' }>;
    }>(`/users/${userId}/import.csv`, { method: 'POST', body: JSON.stringify(body) }),
  importStatement: (userId: number, body: StatementImportBody) =>
    http<ImportResult>(`/users/${userId}/import.statement`, { method: 'POST', body: JSON.stringify(body) }),
  importMappings: (userId: number) => http<ImportMapping[]>(`/users/${userId}/import-mappings`),
  saveImportMapping: (userId: number, body: CreateImportMappingBody) =>
    http<ImportMapping>(`/users/${userId}/import-mappings`, { method: 'POST', body: JSON.stringify(body) }),
  deleteImportMapping: (userId: number, id: number) =>
    http<{ deleted: boolean }>(`/users/${userId}/import-mappings/${id}`, { method: 'DELETE' }),
  trashedTransactions: (userId: number) => http<Transaction[]>(`/users/${userId}/transactions/trash`),
  restoreTransaction: (userId: number, id: number) =>
    http<{ restored: boolean }>(`/users/${userId}/transactions/${id}/restore`, { method: 'POST' }),
  purgeTransaction: (userId: number, id: number) =>
    http<{ purged: boolean }>(`/users/${userId}/transactions/${id}/purge`, { method: 'DELETE' }),
  auditLog: (userId: number) => http<AuditLogEntry[]>(`/users/${userId}/audit-log`),
  backups: (userId: number) => http<BackupMeta[]>(`/users/${userId}/backups`),
  createBackup: (userId: number, label?: string) =>
    http<BackupMeta>(`/users/${userId}/backups`, { method: 'POST', body: JSON.stringify(label ? { label } : {}) }),
  restoreBackup: (userId: number, id: number) =>
    http<BackupImportSummary>(`/users/${userId}/backups/${id}/restore`, { method: 'POST' }),
  deleteBackup: (userId: number, id: number) =>
    http<{ deleted: boolean }>(`/users/${userId}/backups/${id}`, { method: 'DELETE' }),
  // Téléchargements : passent par fetch (et non un simple <a href>) pour porter
  // l'en-tête Authorization quand APP_TOKEN est activé.
  backupBlob: (userId: number, id: number) => httpBlob(`/users/${userId}/backups/${id}/download`),
  exportCsv: (userId: number, range?: { from?: string | null; to?: string | null }) => {
    const params = new URLSearchParams();
    if (range?.from) params.set('from', range.from);
    if (range?.to) params.set('to', range.to);
    const qs = params.toString();
    return httpBlob(`/users/${userId}/transactions.csv${qs ? `?${qs}` : ''}`);
  },
  exportSelection: (userId: number, body: { entities: string[]; from?: string | null; to?: string | null }) =>
    httpBlob(`/users/${userId}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  importJson: (userId: number, payload: unknown) =>
    http<BackupImportSummary>(`/users/${userId}/import.json`, { method: 'POST', body: JSON.stringify({ payload }) }),
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
