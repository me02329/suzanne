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
  amount: number;
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
  assets: number;
  liabilities: number;
  net_worth: number;
  by_group: Record<string, number>;
}
