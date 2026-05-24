export type TransactionType = 'expense' | 'income' | 'transfer';
export type AccountType = 'checking' | 'savings' | 'cash' | 'other';
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
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: number;
  initial_balance_date: string;
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
  day_of_month: number | null;
  active: boolean;
  last_executed: string | null;
  created_at: string;
}

export interface CreateAccountBody {
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: number;
  initial_balance_date: string;
}

export interface CreateCategoryBody {
  name: string;
  type: CategoryType;
  color: string;
  icon?: string | null;
}

export interface CreateTransactionBody {
  account_id?: number | null;
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
  day_of_month?: number | null;
  active?: boolean;
}

export interface DashboardSummary {
  month: string;
  income: number;
  expenses: number;
  net: number;
  balance: number;
  expenses_by_category: Array<{ category_id: number | null; name: string; color: string; amount: number }>;
}
