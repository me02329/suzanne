// Projection du patrimoine à partir de sa répartition réelle (calcul pur) :
// chaque classe d'actifs croît à son rendement typique, l'épargne mensuelle
// est répartie selon des poids donnés.
import type { AssetBucket } from './pyramid.js';
import { futureValue } from './fees.js';

/** Rendements annuels typiques (repères historiques, ordres de grandeur). */
export const TYPICAL_RETURNS: Record<AssetBucket, number> = {
  cash: 0.02,
  bonds: 0.025,
  equities: 0.07,
  real_estate: 0.045,
  alternative: 0,
};

export interface ProjectionInput {
  start: Record<AssetBucket, number>;
  rates: Record<AssetBucket, number>;
  monthly: number;
  /** Poids de répartition du versement mensuel (normalisés). */
  split: Record<AssetBucket, number>;
  years: number;
  /** Versement mensuel supplémentaire en actions (scénario). */
  extraEquities?: number;
}

export interface ProjectionYear { year: number; total: number; contributed: number; byBucket: Record<AssetBucket, number> }

const BUCKETS: AssetBucket[] = ['cash', 'bonds', 'equities', 'real_estate', 'alternative'];

export function projectWealth(input: ProjectionInput): ProjectionYear[] {
  const splitSum = BUCKETS.reduce((s, b) => s + Math.max(0, input.split[b] ?? 0), 0);
  const weight = (b: AssetBucket) => (splitSum > 0 ? Math.max(0, input.split[b] ?? 0) / splitSum : b === 'cash' ? 1 : 0);
  const startTotal = BUCKETS.reduce((s, b) => s + Math.max(0, input.start[b] ?? 0), 0);
  const out: ProjectionYear[] = [];
  for (let y = 0; y <= input.years; y++) {
    const byBucket = Object.fromEntries(BUCKETS.map((b) => {
      const monthly = input.monthly * weight(b) + (b === 'equities' ? input.extraEquities ?? 0 : 0);
      return [b, Math.round(futureValue(Math.max(0, input.start[b] ?? 0), input.rates[b] ?? 0, y, monthly) * 100) / 100];
    })) as Record<AssetBucket, number>;
    const total = BUCKETS.reduce((s, b) => s + byBucket[b], 0);
    out.push({ year: y, total: Math.round(total * 100) / 100, contributed: Math.round((startTotal + (input.monthly + (input.extraEquities ?? 0)) * 12 * y) * 100) / 100, byBucket });
  }
  return out;
}

/** Rendement moyen pondéré par la répartition actuelle. */
export function blendedRate(start: Record<AssetBucket, number>, rates: Record<AssetBucket, number>): number {
  const total = BUCKETS.reduce((s, b) => s + Math.max(0, start[b] ?? 0), 0);
  return total > 0 ? BUCKETS.reduce((s, b) => s + Math.max(0, start[b] ?? 0) * (rates[b] ?? 0), 0) / total : 0;
}

/** Règle de 72 : années pour doubler un capital au taux annuel `rate`. */
export function doublingYears(rate: number): number | null {
  return rate > 0 ? 72 / (rate * 100) : null;
}
