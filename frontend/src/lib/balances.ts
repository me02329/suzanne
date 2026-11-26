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

const isLiquidAccount = (id: number | null, accountById: Map<number, Account>) => {
  if (id == null) return true;
  const account = accountById.get(id);
  return account ? LIQUID_GROUPS.has(accountGroupOf(account)) : true;
};

/**
 * Récurrents vus depuis la trésorerie (comptes liquides) : un virement entre
 * deux comptes liquides ne change rien (écarté) ; vers un prêt, un placement…
 * c'est une sortie ; depuis l'un d'eux, une entrée. Dépenses et revenus : tels
 * quels s'ils touchent un compte liquide.
 */
export function liquidView(recurring: RecurringTransaction[], accountById: Map<number, Account>): RecurringTransaction[] {
  const out: RecurringTransaction[] = [];
  for (const r of recurring) {
    if (r.type !== 'transfer') {
      if (isLiquidRecurring(r, accountById)) out.push(r);
      continue;
    }
    const from = isLiquidAccount(r.account_id, accountById);
    const to = isLiquidAccount(r.to_account_id, accountById);
    if (from && !to) out.push({ ...r, type: 'expense' });
    else if (!from && to) out.push({ ...r, type: 'income', account_id: r.to_account_id });
  }
  return out;
}

// Sum of the liquid accounts' balances, already converted to the report
// currency by the dashboard endpoint. Returns 0 when the summary is absent.
export function liquidBalance(summary: DashboardSummary | null): number {
  if (!summary) return 0;
  return summary.account_balances
    .filter((account) => LIQUID_GROUPS.has(account.group))
    .reduce((sum, account) => sum + account.signed_balance, 0);
}
