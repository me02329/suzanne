// Allocation cible par classe d'actifs et répartition d'un versement pour
// s'en rapprocher sans vendre (calcul pur).
import type { AssetBucket } from './pyramid.js';

export type AllocationTarget = Record<AssetBucket, number>;

/** Profils types (en %) : à personnaliser selon projets, horizon et goût du risque. */
export const ALLOCATION_PRESETS: Record<'prudent' | 'balanced' | 'dynamic', AllocationTarget> = {
  prudent: { cash: 20, bonds: 50, equities: 20, real_estate: 10, alternative: 0 },
  balanced: { cash: 10, bonds: 35, equities: 40, real_estate: 10, alternative: 5 },
  dynamic: { cash: 5, bonds: 15, equities: 65, real_estate: 10, alternative: 5 },
};

export interface RebalanceRow {
  bucket: AssetBucket;
  current: number;
  currentShare: number;
  targetShare: number;
  /** Écart à la cible en montant (positif = au-dessus de la cible). */
  gap: number;
  /** Part du versement à affecter à cette classe. */
  deposit: number;
}

export function rebalance(current: Record<AssetBucket, number>, target: AllocationTarget, deposit = 0): RebalanceRow[] {
  const buckets = Object.keys(target) as AssetBucket[];
  const targetSum = buckets.reduce((s, b) => s + Math.max(0, target[b]), 0) || 1;
  const weight = (b: AssetBucket) => Math.max(0, target[b]) / targetSum;
  const total = buckets.reduce((s, b) => s + Math.max(0, current[b] ?? 0), 0);
  const after = total + Math.max(0, deposit);
  // Manques à combler après versement : le versement va d'abord aux classes sous la cible.
  const needs = buckets.map((b) => Math.max(0, weight(b) * after - (current[b] ?? 0)));
  const needSum = needs.reduce((s, n) => s + n, 0);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const rows = buckets.map((b, i) => {
    const toNeeds = needSum > 0 ? Math.min(deposit, needSum) * (needs[i]! / needSum) : 0;
    const extra = deposit > needSum ? (deposit - needSum) * weight(b) : 0;
    return {
      bucket: b,
      current: round2(current[b] ?? 0),
      currentShare: total > 0 ? (current[b] ?? 0) / total : 0,
      targetShare: weight(b),
      gap: round2((current[b] ?? 0) - weight(b) * total),
      deposit: round2(toNeeds + extra),
    };
  });
  // Reste d'arrondi reporté sur la plus grosse part : le total tombe juste.
  const drift = round2(Math.max(0, deposit) - rows.reduce((s, r) => s + r.deposit, 0));
  if (drift !== 0 && rows.length > 0) {
    const biggest = rows.reduce((m, r) => (r.deposit > m.deposit ? r : m), rows[0]!);
    biggest.deposit = round2(biggest.deposit + drift);
  }
  return rows;
}
