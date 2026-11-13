// Récapitulatif annuel d'une enveloppe (njord : lib/recap.ts, page Recap).
// njord donnait la performance « de l'année » par ETF (cours du 1er janvier au
// 31 décembre), sans tenir compte des achats en cours d'année ; ici la
// performance de l'année est le TWR de l'enveloppe (versements neutralisés).

import { orderBookTotals, type OrderRow } from './orders.js';
import { periodReturn, type IndexPoint } from './twr.js';
import type { DatedAmount } from './tracking.js';

export function availableYears(dates: ReadonlyArray<string>): number[] {
  return [...new Set(dates.map((d) => Number(d.slice(0, 4))).filter((y) => Number.isFinite(y) && y > 1900))].sort((a, b) => b - a);
}

export interface YearRecap {
  year: number;
  deposits: number;
  depositCount: number;
  withdrawals: number;
  netDeposits: number;
  buys: number;
  buyCount: number;
  sells: number;
  sellCount: number;
  fees: number;
  realizedPnl: number;
  /** Revenus encaissés sur le compte (dividendes, coupons…). */
  income: number;
  incomeCount: number;
  /** Valeur au 31/12 de l'année précédente (0 si l'enveloppe n'existait pas). */
  startValue: number | null;
  /** Valeur à la fin de l'année (ou à `asOf` pour l'année en cours). */
  endValue: number | null;
  /** Gain de l'année : fin − début − versements nets. */
  gain: number | null;
  /** TWR de l'année en %, null si pas d'historique. */
  twrPct: number | null;
  /** Historique commencé en cours d'année. */
  partial: boolean;
  byHolding: Array<{ symbol: string; name: string; buys: number; sells: number; realizedPnl: number }>;
}

function valueAt(values: ReadonlyArray<{ date: string; value: number }>, date: string): number | null {
  let found: { date: string; value: number } | null = null;
  for (const v of values) if (v.date <= date && (!found || v.date >= found.date)) found = v;
  return found ? found.value : null;
}

export function buildYearRecap(input: {
  year: number;
  flows: ReadonlyArray<DatedAmount>;
  orders: ReadonlyArray<OrderRow>;
  incomes?: ReadonlyArray<DatedAmount>;
  values: ReadonlyArray<{ date: string; value: number }>;
  index: ReadonlyArray<IndexPoint>;
  asOf: string;
}): YearRecap {
  const { year } = input;
  const inYear = (d: string) => d.slice(0, 4) === String(year);
  const flows = input.flows.filter((f) => inYear(f.date));
  const deposits = flows.filter((f) => f.amount > 0);
  const withdrawals = flows.filter((f) => f.amount < 0);
  const orders = input.orders.filter((o) => inYear(o.date));
  const totals = orderBookTotals(orders);
  const incomes = (input.incomes ?? []).filter((f) => inYear(f.date));

  const prevEnd = `${year - 1}-12-31`;
  const yearEnd = `${year}-12-31` < input.asOf.slice(0, 10) ? `${year}-12-31` : input.asOf.slice(0, 10);
  const firstValueDate = [...input.values].sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? null;
  const startValue = firstValueDate == null ? null : (valueAt(input.values, prevEnd) ?? 0);
  const endValue = valueAt(input.values, yearEnd);
  const netDeposits = flows.reduce((s, f) => s + f.amount, 0);
  const twr = periodReturn(input.index, prevEnd, yearEnd);

  const byHolding = new Map<string, YearRecap['byHolding'][number]>();
  for (const o of orders) {
    const row = byHolding.get(o.symbol) ?? { symbol: o.symbol, name: o.name, buys: 0, sells: 0, realizedPnl: 0 };
    if (o.side === 'buy') row.buys += o.total;
    else { row.sells += o.total; row.realizedPnl += o.realizedPnl ?? 0; }
    byHolding.set(o.symbol, row);
  }

  return {
    year,
    deposits: round2(deposits.reduce((s, f) => s + f.amount, 0)),
    depositCount: deposits.length,
    withdrawals: round2(-withdrawals.reduce((s, f) => s + f.amount, 0)),
    netDeposits: round2(netDeposits),
    buys: totals.buys,
    buyCount: totals.buyCount,
    sells: totals.sells,
    sellCount: totals.sellCount,
    fees: totals.fees,
    realizedPnl: totals.realizedPnl,
    income: round2(incomes.reduce((s, f) => s + f.amount, 0)),
    incomeCount: incomes.length,
    startValue: startValue == null ? null : round2(startValue),
    endValue: endValue == null ? null : round2(endValue),
    gain: startValue != null && endValue != null ? round2(endValue - startValue - netDeposits) : null,
    twrPct: twr.returnPct,
    partial: twr.partial,
    byHolding: [...byHolding.values()]
      .map((r) => ({ ...r, buys: round2(r.buys), sells: round2(r.sells), realizedPnl: round2(r.realizedPnl) }))
      .sort((a, b) => b.buys + b.sells - (a.buys + a.sells)),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
