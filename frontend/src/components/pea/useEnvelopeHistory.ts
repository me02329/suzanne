import { useEffect, useMemo, useState } from 'react';
import { fridayOnOrAfter, type Holding, type Transaction } from '@suzanne/shared';
import { api } from '../../lib/api';
import { pricesApi } from '../../lib/api-pea';
import type { EnvelopeFlow } from '../../lib/pea';
import type { AccountWithInvestment } from '../../lib/api-accounts';

export interface EnvelopeHistory {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Positions du compte avec leurs ordres. */
  holdings: Holding[];
  /** Valeur hebdomadaire (vendredis + aujourd'hui), devise du compte. */
  values: Array<{ date: string; value: number }>;
}

const EMPTY: EnvelopeHistory = { status: 'idle', holdings: [], values: [] };

/**
 * Historique d'une enveloppe : valeur chaque vendredi depuis le premier
 * versement/ordre (wealth-history hebdomadaire, titres valorisés à la date).
 * On précharge d'abord l'historique de cours de chaque titre (un appel Yahoo
 * par symbole côté serveur) pour que wealth-history lise le cache au lieu
 * d'interroger Yahoo date par date.
 */
export function useEnvelopeHistory(
  userId: number,
  account: AccountWithInvestment,
  flows: EnvelopeFlow[],
  enabled: boolean,
  reloadKey: unknown,
  currentValue: number | null,
  today: string,
): EnvelopeHistory {
  const [state, setState] = useState<EnvelopeHistory>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    (async () => {
      const all = await api.holdings(userId);
      const own = all.filter((h) => h.account_id === account.id);
      const firstOrder = (h: Holding) => h.orders.reduce<string | null>((m, o) => (!m || o.date < m ? o.date.slice(0, 10) : m), null);
      const starts = [...flows.map((f) => f.date), ...own.map(firstOrder).filter((d): d is string => d != null)].sort();
      const start = starts[0];
      if (!start) return { holdings: own, values: [] };
      await Promise.allSettled(
        all.filter((h) => h.orders.length > 0).map((h) => {
          const first = firstOrder(h)!;
          return pricesApi.history(h.symbol, first > start ? first : start, today);
        }),
      );
      const points = await api.wealthHistory(userId, 'custom', 'week', account.currency, fridayOnOrAfter(start), today);
      return { holdings: own, values: points.map((p) => ({ date: p.date.slice(0, 10), value: p.by_account[account.id] ?? 0 })) };
    })()
      .then((r) => { if (!cancelled) setState({ status: 'ready', ...r }); })
      .catch(() => { if (!cancelled) setState({ status: 'error', holdings: [], values: [] }); });
    return () => { cancelled = true; };
    // flows suit reloadKey (rechargés ensemble par la fiche compte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, account.id, account.currency, enabled, reloadKey, today]);

  // Le point du jour reprend la valorisation affichée en tête de fiche.
  return useMemo(() => {
    if (currentValue == null || state.values.length === 0) return state;
    const values = state.values.slice();
    const last = values[values.length - 1]!;
    if (last.date === today) values[values.length - 1] = { date: today, value: currentValue };
    else if (last.date < today) values.push({ date: today, value: currentValue });
    return { ...state, values };
  }, [state, currentValue, today]);
}

/** Revenus encaissés sur le compte (dividendes, coupons) : opérations standard créditrices. */
export function envelopeIncomes(transactions: Transaction[], accountId: number): EnvelopeFlow[] {
  const out: EnvelopeFlow[] = [];
  for (const tx of transactions) {
    if (tx.kind !== 'standard') continue;
    const amount = tx.lines.filter((l) => l.account_id === accountId).reduce((s, l) => s + l.amount, 0);
    if (amount <= 0.005) continue;
    out.push({ id: tx.id, date: tx.date.slice(0, 10), amount: Math.round(amount * 100) / 100, description: tx.description });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
