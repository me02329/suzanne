import type { DashboardSummary } from '@suzanne-lite/shared';

// Liquid accounts whose balance the recurring income/expenses actually move,
// and the base for the emergency-fund metric. Investments, crypto and
// liabilities are deliberately excluded.
export const LIQUID_GROUPS = new Set(['cash', 'regulated_savings']);

// Sum of the liquid accounts' balances, already converted to the report
// currency by the dashboard endpoint. Returns 0 when the summary is absent.
export function liquidBalance(summary: DashboardSummary | null): number {
  if (!summary) return 0;
  return summary.account_balances
    .filter((account) => LIQUID_GROUPS.has(account.group))
    .reduce((sum, account) => sum + account.signed_balance, 0);
}
