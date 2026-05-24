import type {
  Account,
  AccountSnapshot,
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
  CreateTransactionBody,
  DashboardSummary,
  Institution,
  RecurringTransaction,
  SavingsGoal,
  SearchResult,
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
  deleteUser: (id: number) => http<{ deleted: boolean }>(`/users/${id}`, { method: 'DELETE' }),
  accounts: (userId: number) => http<Account[]>(`/users/${userId}/accounts`),
  createAccount: (userId: number, body: CreateAccountBody) => http<Account>(`/users/${userId}/accounts`, { method: 'POST', body: JSON.stringify(body) }),
  deleteAccount: (id: number) => http<{ deleted: boolean }>(`/accounts/${id}`, { method: 'DELETE' }),
  institutions: (userId: number) => http<Institution[]>(`/users/${userId}/institutions`),
  createInstitution: (userId: number, body: CreateInstitutionBody) => http<Institution>(`/users/${userId}/institutions`, { method: 'POST', body: JSON.stringify(body) }),
  deleteInstitution: (id: number) => http<{ deleted: boolean }>(`/institutions/${id}`, { method: 'DELETE' }),
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
  rules: (userId: number) => http<CategoryRule[]>(`/users/${userId}/category-rules`),
  setRule: (userId: number, body: CreateCategoryRuleBody) => http<CategoryRule>(`/users/${userId}/category-rules`, { method: 'POST', body: JSON.stringify(body) }),
  deleteRule: (id: number) => http<{ deleted: boolean }>(`/category-rules/${id}`, { method: 'DELETE' }),
  goals: (userId: number) => http<SavingsGoal[]>(`/users/${userId}/savings-goals`),
  createGoal: (userId: number, body: CreateSavingsGoalBody) => http<SavingsGoal>(`/users/${userId}/savings-goals`, { method: 'POST', body: JSON.stringify(body) }),
  updateGoal: (id: number, body: Partial<CreateSavingsGoalBody>) => http<SavingsGoal>(`/savings-goals/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteGoal: (id: number) => http<{ deleted: boolean }>(`/savings-goals/${id}`, { method: 'DELETE' }),
  snapshots: (userId: number) => http<AccountSnapshot[]>(`/users/${userId}/account-snapshots`),
  setSnapshot: (userId: number, body: CreateAccountSnapshotBody) => http<AccountSnapshot>(`/users/${userId}/account-snapshots`, { method: 'POST', body: JSON.stringify(body) }),
  deleteSnapshot: (id: number) => http<{ deleted: boolean }>(`/account-snapshots/${id}`, { method: 'DELETE' }),
  importCsv: (userId: number, body: { csv: string; account_id?: number | null }) => http<{ imported: number }>(`/users/${userId}/import.csv`, { method: 'POST', body: JSON.stringify(body) }),
  exportJsonUrl: (userId: number) => `${API_BASE}/users/${userId}/export.json`,
  exportCsvUrl: (userId: number) => `${API_BASE}/users/${userId}/transactions.csv`,
  search: (userId: number, q: string) => http<SearchResult[]>(`/users/${userId}/search?q=${encodeURIComponent(q)}`),
};
