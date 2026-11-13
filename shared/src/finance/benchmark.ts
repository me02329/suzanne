// Comparaison à un indice de référence : « si chaque versement avait acheté
// l'indice à sa date ». Porté depuis njord (lib/benchmark.ts) en corrigeant la
// comparaison : njord ignorait côté indice les versements antérieurs à
// l'historique de cours mais les gardait côté portefeuille (capital différent).
// Ici, si des versements précèdent l'historique, les deux côtés démarrent à la
// même date avec le même capital : la valeur du portefeuille à cette date.

import { xirr } from './xirr.js';
import type { DatedAmount } from './tracking.js';

export interface PricePoint {
  date: string;
  price: number;
}

/** Cours au dernier jour coté ≤ date (recherche dichotomique ; `history` trié). */
export function priceOnOrBefore(history: ReadonlyArray<PricePoint>, date: string): number | null {
  let lo = 0;
  let hi = history.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid]!.date <= date) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? history[best]!.price : null;
}

export interface SideResult {
  value: number;
  gain: number;
  gainPct: number | null;
  /** Rendement annualisé (XIRR, %), null sous un an. */
  xirr: number | null;
}

export interface BenchmarkComparison {
  /** Début de la comparaison. */
  start: string;
  /** Valeur du portefeuille reprise au départ (versements antérieurs à l'historique), 0 sinon. */
  startValue: number;
  /** Nombre de versements absorbés dans la valeur de départ. */
  absorbedFlows: number;
  /** Capital comparé : valeur de départ + versements nets suivants. */
  capital: number;
  units: number;
  portfolio: SideResult;
  benchmark: SideResult;
  series: Array<{ date: string; portfolio: number; benchmark: number; contributed: number }>;
}

export function compareWithBenchmark(input: {
  flows: ReadonlyArray<DatedAmount>;
  /** Cours de l'indice (tous les jours cotés de la période). */
  history: ReadonlyArray<PricePoint>;
  /** Valorisation du portefeuille dans le temps (pour la courbe et le point de départ). */
  values: ReadonlyArray<{ date: string; value: number }>;
  /** Valeur actuelle du portefeuille. */
  currentValue: number;
  asOf: string;
}): BenchmarkComparison | null {
  const history = [...input.history].filter((p) => p.price > 0).sort((a, b) => a.date.localeCompare(b.date));
  const flows = input.flows.map((f) => ({ date: f.date.slice(0, 10), amount: f.amount })).filter((f) => f.amount !== 0).sort((a, b) => a.date.localeCompare(b.date));
  const values = [...input.values].sort((a, b) => a.date.localeCompare(b.date));
  if (history.length === 0 || flows.length === 0) return null;
  const asOf = input.asOf.slice(0, 10);
  const lastPrice = priceOnOrBefore(history, asOf);
  if (lastPrice == null) return null;

  let start = flows[0]!.date;
  let startValue = 0;
  let absorbed = 0;
  let shifted = false;
  if (start < history[0]!.date) {
    // Point de départ commun : première valorisation connue dès que l'indice cote.
    const startPoint = values.find((v) => v.date >= history[0]!.date);
    if (!startPoint) return null;
    start = startPoint.date;
    startValue = startPoint.value;
    absorbed = flows.filter((f) => f.date <= start).length;
    shifted = true;
  }
  const later = shifted ? flows.filter((f) => f.date > start) : flows;

  const startPrice = priceOnOrBefore(history, start);
  if (startPrice == null) return null;
  let units = startValue / startPrice;
  const unitsAt: Array<{ date: string; units: number; contributed: number }> = [];
  let contributed = startValue;
  for (const f of later) {
    const price = priceOnOrBefore(history, f.date) ?? startPrice;
    units += f.amount / price;
    contributed += f.amount;
    unitsAt.push({ date: f.date, units, contributed });
  }
  const benchValue = units * lastPrice;

  const series: BenchmarkComparison['series'] = [];
  let ui = 0;
  let u = startValue / startPrice;
  let c = startValue;
  for (const v of values) {
    if (v.date < start) continue;
    while (ui < unitsAt.length && unitsAt[ui]!.date <= v.date) {
      u = unitsAt[ui]!.units;
      c = unitsAt[ui]!.contributed;
      ui += 1;
    }
    const price = priceOnOrBefore(history, v.date);
    if (price == null) continue;
    series.push({ date: v.date, portfolio: v.value, benchmark: round2(u * price), contributed: round2(c) });
  }

  const cash = [
    ...(startValue > 0 ? [{ date: start, amount: -startValue }] : []),
    ...later.map((f) => ({ date: f.date, amount: -f.amount })),
  ];
  const years = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 / 365;
  const side = (value: number): SideResult => ({
    value: round2(value),
    gain: round2(value - contributed),
    gainPct: contributed > 0 ? ((value - contributed) / contributed) * 100 : null,
    xirr: years >= 1 && value > 0 ? xirr([...cash, { date: asOf, amount: value }]) : null,
  });

  return {
    start,
    startValue: round2(startValue),
    absorbedFlows: absorbed,
    capital: round2(contributed),
    units,
    portfolio: side(input.currentValue),
    benchmark: side(benchValue),
    series,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
