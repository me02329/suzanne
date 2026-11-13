import { xirr } from './xirr.js';
import { daysBetween } from './pea.js';

export interface PerformanceResult {
  /** 'xirr' = rendement annualisé pondéré par les flux ; 'cumulative' = gain / versements nets. */
  kind: 'xirr' | 'cumulative';
  /** En pourcentage (7.3 = +7,3 %), null si non calculable. */
  rate: number | null;
  /** Plus-value totale : valeur − versements nets. */
  gain: number;
  netDeposits: number;
  /** Ancienneté (années) depuis le premier flux. */
  years: number;
}

/**
 * Performance d'une enveloppe alimentée par versements (+) et retraits (−).
 * Moins d'un an d'historique : performance cumulée (un taux annualisé sur
 * quelques semaines n'a pas de sens) ; au-delà : XIRR.
 */
export function envelopePerformance(
  flows: ReadonlyArray<{ date: string; amount: number }>,
  value: number,
  asOf: string,
): PerformanceResult {
  const sorted = [...flows].filter((f) => f.amount !== 0).sort((a, b) => a.date.localeCompare(b.date));
  const netDeposits = sorted.reduce((s, f) => s + f.amount, 0);
  const gain = value - netDeposits;
  if (sorted.length === 0) return { kind: 'cumulative', rate: null, gain, netDeposits, years: 0 };
  const years = Math.max(0, daysBetween(sorted[0]!.date.slice(0, 10), asOf.slice(0, 10))) / 365;
  if (years < 1) {
    return { kind: 'cumulative', rate: netDeposits > 0 ? (gain / netDeposits) * 100 : null, gain, netDeposits, years };
  }
  const cashflows = sorted.map((f) => ({ date: f.date.slice(0, 10), amount: -f.amount }));
  if (value > 0) cashflows.push({ date: asOf.slice(0, 10), amount: value });
  return { kind: 'xirr', rate: xirr(cashflows), gain, netDeposits, years };
}
