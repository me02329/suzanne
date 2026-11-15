import { useEffect, useMemo, useState } from 'react';
import { buildPyramid, type Account, type DashboardSummary, type HoldingsValuation, type Institution, type PyramidResult } from '@suzanne/shared';
import { api } from './api';

/** Dépenses mensuelles moyennes : les mois passés de la courbe sur 12 mois. */
export function averageMonthlyExpenses(summary: DashboardSummary | null): number | null {
  const current = new Date().toISOString().slice(0, 7);
  const months = (summary?.monthly_cashflow ?? []).filter((m) => m.month < current && m.expenses > 0);
  return months.length > 0 ? months.reduce((s, m) => s + m.expenses, 0) / months.length : null;
}

/**
 * Pyramide de l'épargne à partir des soldes du tableau de bord et des
 * positions valorisées (partagé par Diversification et la feuille de route).
 */
export function usePyramid(userId: number, accounts: Account[], institutions: Institution[], summary: DashboardSummary | null, reportCurrency: string) {
  const [valuation, setValuation] = useState<HoldingsValuation | null>(null);
  const currency = summary?.currency ?? reportCurrency;

  useEffect(() => {
    let cancelled = false;
    api.holdingsValuation(userId, currency)
      .then((v) => { if (!cancelled) setValuation(v); })
      .catch(() => { if (!cancelled) setValuation({ currency, market_value: 0, cost_basis: 0, unrealized_pnl: 0, unrealized_pnl_pct: 0, holdings: [], allocation: [] }); });
    return () => { cancelled = true; };
  }, [userId, currency, summary]);

  const monthlyExpenses = useMemo(() => averageMonthlyExpenses(summary), [summary]);

  const pyramid: PyramidResult | null = useMemo(() => {
    if (!summary || !valuation) return null;
    const institutionName = new Map(institutions.map((i) => [i.id, i.name]));
    const balanceOf = new Map(summary.account_balances.map((b) => [b.account_id, b.signed_balance]));
    return buildPyramid(
      accounts.filter((a) => !a.archived).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        professional: a.professional,
        institution: a.institution_id != null ? institutionName.get(a.institution_id) ?? null : null,
        balance: balanceOf.get(a.id) ?? 0,
        positions: valuation.holdings
          .filter((h) => h.account_id === a.id && h.quantity > 0)
          .map((h) => ({ symbol: h.symbol, name: h.name, asset_class: h.asset_class, value: h.market_value })),
      })),
      monthlyExpenses,
    );
  }, [accounts, institutions, summary, valuation, monthlyExpenses]);

  return { pyramid, valuation, monthlyExpenses, currency };
}
