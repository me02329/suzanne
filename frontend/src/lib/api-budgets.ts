import type { BudgetStatus } from '@suzanne/shared';
import { http } from './api';

// Planification budgétaire : budget global (reste à vivre), rythme, suggestions,
// historique, provisions pour dépenses irrégulières.

export type PaceStatus = 'ok' | 'warning' | 'projected_over' | 'over';
export interface Pace {
  elapsed_ratio: number;
  projected: number;
  percent: number;
  status: PaceStatus;
  daily_allowance: number | null;
  days_left: number;
}
export type BudgetWithPace = BudgetStatus & { pace: Pace };

export interface SinkingFund {
  id: number;
  name: string;
  category_id: number | null;
  target_amount: number;
  period_months: number;
  start_month: string;
  color: string;
}
export interface SinkingFundStatus extends SinkingFund {
  cycle_start: string;
  cycle_end: string;
  months_elapsed: number;
  monthly_contribution: number;
  accrued: number;
  spent: number;
  available: number;
}

export interface BudgetOverview {
  month: string;
  currency: string;
  total_spent: number;
  budgeted_spent: number;
  unbudgeted_spent: number;
  global: { id: number; month: string; amount_limit: number; recurring: boolean; spent: number; remaining: number; pace: Pace } | null;
  categories: BudgetWithPace[];
  sinking_funds: SinkingFundStatus[];
}

export interface Suggestion { median: number; average: number; months_used: number; suggested: number }
export interface BudgetSuggestions {
  month: string;
  months: string[];
  categories: Array<Suggestion & { category_id: number; name: string; color: string; history: number[] }>;
  global: Suggestion | null;
}

export interface BudgetHistoryPoint {
  month: string;
  total_spent: number;
  global_limit: number | null;
  categories: Array<{ category_id: number; limit: number; spent: number }>;
}

const q = (month: string, currency: string) => `month=${month}&currency=${encodeURIComponent(currency)}`;

export const budgetsApi = {
  overview: (userId: number, month: string, currency: string) =>
    http<BudgetOverview>(`/users/${userId}/budgets/overview?${q(month, currency)}`),
  setGlobal: (userId: number, body: { month: string; amount_limit: number; recurring?: boolean }) =>
    http(`/users/${userId}/budgets/global`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGlobal: (userId: number, month: string) =>
    http(`/users/${userId}/budgets/global/${month}`, { method: 'DELETE' }),
  suggestions: (userId: number, month: string, currency: string) =>
    http<BudgetSuggestions>(`/users/${userId}/budgets/suggestions?${q(month, currency)}`),
  history: (userId: number, month: string, currency: string, months = 6) =>
    http<BudgetHistoryPoint[]>(`/users/${userId}/budgets/history?${q(month, currency)}&months=${months}`),
  createFund: (userId: number, body: Omit<SinkingFund, 'id' | 'color'> & { color?: string }) =>
    http<SinkingFund>(`/users/${userId}/sinking-funds`, { method: 'POST', body: JSON.stringify(body) }),
  updateFund: (userId: number, id: number, body: Partial<Omit<SinkingFund, 'id'>>) =>
    http<SinkingFund>(`/users/${userId}/sinking-funds/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteFund: (userId: number, id: number) =>
    http(`/users/${userId}/sinking-funds/${id}`, { method: 'DELETE' }),
};

export const PACE_LABEL: Record<PaceStatus, string> = {
  ok: 'Dans les clous',
  warning: 'Attention',
  projected_over: 'Dépassement probable',
  over: 'Dépassé',
};
