import { accountGroupOf, type Account, type DashboardSummary, type RecurringTransaction } from '@suzanne/shared';

// Liquid accounts whose balance the recurring income/expenses actually move,
// and the base for the emergency-fund metric. Investments, crypto and
// liabilities are deliberately excluded.
export const LIQUID_GROUPS = new Set<string>(['cash', 'regulated_savings']);

// Whether a recurring belongs in a liquid-balance projection. It does when it
// moves a liquid account, or has no account at all (a generic cashflow). One
// tied to an investment/crypto/liability account moves *that* balance, not the
// liquid cash the forecast starts from, so it must be excluded. An orphaned
// account_id (account deleted) is kept rather than silently dropped.
export function isLiquidRecurring(r: RecurringTransaction, accountById: Map<number, Account>): boolean {
  if (r.account_id == null) return true;
  const account = accountById.get(r.account_id);
  return account ? LIQUID_GROUPS.has(accountGroupOf(account)) : true;
}

// Sum of the liquid accounts' balances, already converted to the report
// currency by the dashboard endpoint. Returns 0 when the summary is absent.
export function liquidBalance(summary: DashboardSummary | null): number {
  if (!summary) return 0;
  return summary.account_balances
    .filter((account) => LIQUID_GROUPS.has(account.group))
    .reduce((sum, account) => sum + account.signed_balance, 0);
}
