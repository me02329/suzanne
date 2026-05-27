export type TransactionType = 'expense' | 'income' | 'transfer';
export type AccountType =
  | 'checking'
  | 'savings'
  | 'livret_a'
  | 'ldds'
  | 'lep'
  | 'pel'
  | 'cel'
  | 'pea'
  | 'securities'
  | 'life_insurance'
  | 'crypto'
  | 'retirement'
  | 'cash'
  | 'credit'
  | 'loan'
  | 'other';
export type CategoryType = 'expense' | 'income';
export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export interface User {
  id: number;
  name: string;
  created_at: string;
}

export interface Account {
  id: number;
  user_id: number;
  institution_id: number | null;
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: number;
  initial_balance_date: string;
  created_at: string;
}

export interface Institution {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
}

export interface Category {
  id: number;
  user_id: number;
  name: string;
  type: CategoryType;
  color: string;
  icon: string | null;
  created_at: string;
}

export interface Transaction {
  id: number;
  user_id: number;
  account_id: number | null;
  to_account_id: number | null;
  category_id: number | null;
  recurring_transaction_id: number | null;
  amount: number;
  to_amount: number | null;
  exchange_rate: number | null;
  type: TransactionType;
  date: string;
  description: string | null;
  created_at: string;
}

export interface Budget {
  id: number;
  user_id: number;
  category_id: number;
  month: string;
  amount_limit: number;
  created_at: string;
}

export interface RecurringTransaction {
  id: number;
  user_id: number;
  account_id: number | null;
  category_id: number | null;
  amount: number;
  type: Exclude<TransactionType, 'transfer'>;
  description: string;
  frequency: RecurringFrequency;
  interval: number;
  day_of_month: number | null;
  active: boolean;
  last_executed: string | null;
  created_at: string;
}

export interface CategoryRule {
  id: number;
  user_id: number;
  pattern: string;
  category_id: number;
  created_at: string;
}

export interface SavingsGoal {
  id: number;
  user_id: number;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  color: string;
  created_at: string;
}

export interface AccountSnapshot {
  id: number;
  user_id: number;
  account_id: number;
  date: string;
  balance: number;
  created_at: string;
}

export interface CreateAccountBody {
  institution_id?: number | null;
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: number;
  initial_balance_date: string;
}

export interface CreateInstitutionBody {
  name: string;
}

export interface CreateCategoryBody {
  name: string;
  type: CategoryType;
  color: string;
  icon?: string | null;
}

export interface CreateTransactionBody {
  account_id?: number | null;
  to_account_id?: number | null;
  category_id?: number | null;
  amount: number;
  to_amount?: number | null;
  type: TransactionType;
  date: string;
  description?: string | null;
}

export interface CreateBudgetBody {
  category_id: number;
  month: string;
  amount_limit: number;
}

export interface CreateRecurringBody {
  account_id?: number | null;
  category_id?: number | null;
  amount: number;
  type: Exclude<TransactionType, 'transfer'>;
  description: string;
  frequency: RecurringFrequency;
  interval?: number;
  day_of_month?: number | null;
  active?: boolean;
}

export interface CreateCategoryRuleBody {
  pattern: string;
  category_id: number;
}

export interface CreateSavingsGoalBody {
  name: string;
  target_amount: number;
  current_amount?: number;
  deadline?: string | null;
  color: string;
}

export interface CreateAccountSnapshotBody {
  account_id: number;
  date: string;
  balance: number;
}

export interface SearchResult {
  type: 'transaction' | 'category' | 'account' | 'goal';
  id: number;
  title: string;
  subtitle: string;
}

export interface DashboardSummary {
  month: string;
  currency: string;
  exchange_rates: Record<string, number>;
  income: number;
  expenses: number;
  net: number;
  balance: number;
  balance_assets: number;
  balance_liabilities: number;
  net_worth: number;
  account_balances: Array<{
    account_id: number;
    name: string;
    type: AccountType;
    currency: string;
    type_label: string;
    group: string;
    group_label: string;
    balance: number;
    signed_balance: number;
    is_liability: boolean;
  }>;
  balance_by_group: Array<{
    group: string;
    label: string;
    amount: number;
    signed_amount: number;
    is_liability: boolean;
  }>;
  expenses_by_category: Array<{ category_id: number | null; name: string; color: string; amount: number }>;
  monthly_cashflow: Array<{ month: string; income: number; expenses: number; net: number }>;
  yearly_cashflow: Array<{ year: string; income: number; expenses: number; net: number }>;
}

export interface WealthHistoryPoint {
  date: string;
  currency: string;
  assets: number;
  liabilities: number;
  net_worth: number;
  by_group: Record<string, number>;
}

export type StatisticsRange = '3m' | '6m' | '1y' | '2y' | 'all';

export interface StatisticsSummary {
  range: StatisticsRange;
  currency: string;
  from: string;
  to: string;
  exclude_uncategorized: boolean;
  total_expenses: number;
  total_categorized: number;
  total_uncategorized: number;
  transactions_count: number;
  by_category: Array<{ category_id: number | null; name: string; color: string; amount: number; transactions_count: number }>;
  by_merchant: Array<{ description: string; amount: number; transactions_count: number }>;
  monthly: Array<{ month: string; amount: number }>;
}

// ---------------------------------------------------------------------------
// Account taxonomy: source of truth pour les types/groupes de comptes,
// utilisée par le backend (calcul de soldes, search) et le frontend (forms,
// dashboard, alertes). Ne pas dupliquer ailleurs.
// ---------------------------------------------------------------------------

export type AccountGroup = 'cash' | 'regulated_savings' | 'investments' | 'crypto' | 'liabilities' | 'other';

export const ACCOUNT_TYPES: ReadonlyArray<{ value: AccountType; label: string; group: AccountGroup }> = [
  { value: 'checking', label: 'Compte courant', group: 'cash' },
  { value: 'cash', label: 'Espèces', group: 'cash' },
  { value: 'savings', label: 'Épargne', group: 'regulated_savings' },
  { value: 'livret_a', label: 'Livret A', group: 'regulated_savings' },
  { value: 'ldds', label: 'LDDS', group: 'regulated_savings' },
  { value: 'lep', label: 'LEP', group: 'regulated_savings' },
  { value: 'pel', label: 'PEL', group: 'regulated_savings' },
  { value: 'cel', label: 'CEL', group: 'regulated_savings' },
  { value: 'pea', label: 'PEA', group: 'investments' },
  { value: 'securities', label: 'Compte-titres', group: 'investments' },
  { value: 'life_insurance', label: 'Assurance-vie', group: 'investments' },
  { value: 'retirement', label: 'Retraite', group: 'investments' },
  { value: 'crypto', label: 'Crypto', group: 'crypto' },
  { value: 'credit', label: 'Carte / crédit', group: 'liabilities' },
  { value: 'loan', label: 'Emprunt', group: 'liabilities' },
  { value: 'other', label: 'Autre', group: 'other' },
];

export const ACCOUNT_GROUPS: ReadonlyArray<{ value: AccountGroup; label: string; color: string }> = [
  { value: 'cash', label: 'Liquidités', color: '#2563eb' },
  { value: 'regulated_savings', label: 'Livrets', color: '#10b981' },
  { value: 'investments', label: 'Investissements', color: '#7c3aed' },
  { value: 'crypto', label: 'Crypto', color: '#f59e0b' },
  { value: 'liabilities', label: 'Passifs', color: '#dc2626' },
  { value: 'other', label: 'Autres', color: '#64748b' },
];

const ACCOUNT_TYPE_INDEX = new Map(ACCOUNT_TYPES.map((entry) => [entry.value, entry]));
const ACCOUNT_GROUP_INDEX = new Map(ACCOUNT_GROUPS.map((entry) => [entry.value, entry]));

export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPE_INDEX.get(type)?.label ?? type;
}

export function accountTypeGroup(type: AccountType): AccountGroup {
  return ACCOUNT_TYPE_INDEX.get(type)?.group ?? 'other';
}

export function accountGroupLabel(group: string): string {
  return ACCOUNT_GROUP_INDEX.get(group as AccountGroup)?.label ?? group;
}

export function accountGroupColor(group: string): string {
  return ACCOUNT_GROUP_INDEX.get(group as AccountGroup)?.color ?? '#64748b';
}

export const LIVRET_CEILINGS: Partial<Record<AccountType, number>> = {
  livret_a: 22950,
  ldds: 12000,
  lep: 10000,
};

export const REPORT_CURRENCIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'JPY', label: 'JPY - Yen japonais' },
  { value: 'USD', label: 'USD - Dollar US' },
  { value: 'GBP', label: 'GBP - Livre sterling' },
  { value: 'CHF', label: 'CHF - Franc suisse' },
  { value: 'CAD', label: 'CAD - Dollar canadien' },
  { value: 'AUD', label: 'AUD - Dollar australien' },
];
