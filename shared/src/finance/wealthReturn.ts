// Rendement de l'épargne placée, tous comptes confondus (calcul pur).
//
// Entrées : la valeur de l'ensemble à intervalles réguliers (historique) et les
// versements nets venus de l'extérieur (virements depuis / vers les comptes
// non placés). Les virements entre comptes placés s'annulent ; intérêts,
// dividendes et plus-values sont du rendement.
import { xirr, type CashFlow } from './xirr.js';

export interface ValuePoint { date: string; value: number }
export interface NetFlow { date: string; /** > 0 versé, < 0 retiré. */ amount: number }

export interface WealthReturn {
  /** Rendement annualisé depuis le début (XIRR, en %), null si incalculable. */
  annualized: number | null;
  since: string | null;
  /** Total versé net (hors valeur de départ). */
  netDeposits: number;
  startValue: number;
  currentValue: number;
  /** Gain = valeur actuelle − départ − versements nets. */
  gain: number;
  /** Rendement par année civile (Modified Dietz, en %). */
  byYear: Array<{ year: string; pct: number | null; gain: number }>;
}

const dayNum = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400_000;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function wealthReturn(series: ValuePoint[], flows: NetFlow[], asOf: string, currentValue: number): WealthReturn {
  const points = series.filter((p) => p.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  const first = points.find((p) => Math.abs(p.value) > 0.005);
  if (!first) return { annualized: null, since: null, netDeposits: 0, startValue: 0, currentValue, gain: 0, byYear: [] };
  const start = first.date;
  const inRange = flows.filter((f) => f.date > start && f.date <= asOf && Math.abs(f.amount) > 0.005);
  const netDeposits = inRange.reduce((s, f) => s + f.amount, 0);

  // XIRR : valeur de départ et versements sortent de la poche, la valeur actuelle y revient.
  const cash: CashFlow[] = [{ date: start, amount: -first.value }, ...inRange.map((f) => ({ date: f.date, amount: -f.amount })), { date: asOf, amount: currentValue }];
  const annualized = currentValue > 0 ? xirr(cash) : null;

  // Par année civile (Modified Dietz) : gain / (valeur de début + versements pondérés par leur durée).
  const valueAt = (date: string) => {
    let v = first.value;
    for (const p of points) { if (p.date <= date) v = p.value; else break; }
    return v;
  };
  const byYear: WealthReturn['byYear'] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(asOf.slice(0, 4)); y++) {
    const from = y === Number(start.slice(0, 4)) ? start : `${y - 1}-12-31`;
    const to = y === Number(asOf.slice(0, 4)) ? asOf : `${y}-12-31`;
    const v0 = from === start ? first.value : valueAt(from);
    const v1 = to === asOf ? currentValue : valueAt(to);
    const span = Math.max(1, dayNum(to) - dayNum(from));
    const yearFlows = inRange.filter((f) => f.date > from && f.date <= to);
    const f = yearFlows.reduce((s, x) => s + x.amount, 0);
    const weighted = yearFlows.reduce((s, x) => s + x.amount * ((dayNum(to) - dayNum(x.date)) / span), 0);
    const gain = v1 - v0 - f;
    const base = v0 + weighted;
    byYear.push({ year: String(y), pct: base > 1 ? Math.round((gain / base) * 10000) / 100 : null, gain: round2(gain) });
  }

  return {
    annualized: annualized == null ? null : Math.round(annualized * 100) / 100,
    since: start,
    netDeposits: round2(netDeposits),
    startValue: round2(first.value),
    currentValue: round2(currentValue),
    gain: round2(currentValue - first.value - netDeposits),
    byYear,
  };
}
