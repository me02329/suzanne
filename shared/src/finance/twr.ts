// Performance pondérée par le temps (TWR) d'une enveloppe alimentée par des
// versements. Porté depuis njord (frontend/src/lib/analytics.ts) en corrigeant
// son défaut principal : njord calculait le drawdown sur la valeur brute, où un
// versement masque une baisse (−10 % de marché + 10 % de versement = « 0 % »).
// Ici tout est calculé sur un indice TWR qui neutralise versements et retraits.
// Dates ISO (YYYY-MM-DD), comparées comme chaînes : aucun fuseau horaire.

export interface FlowValuePoint {
  date: string;
  /** Valeur de l'enveloppe à cette date (titres + espèces). */
  value: number;
  /** Flux externes nets (versements − retraits) depuis le point précédent. */
  flow: number;
}

export interface IndexPoint {
  date: string;
  /** Indice base 1 au premier point. */
  index: number;
}

/**
 * Indice TWR chaîné. Sur chaque période, le flux est supposé arrivé en début de
 * période (versement puis achat dans la foulée) :
 *   r = V_i / (V_{i−1} + F_i) − 1.
 * Une base nulle ou négative (enveloppe vide) donne r = 0.
 */
export function twrIndex(points: ReadonlyArray<FlowValuePoint>): IndexPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: IndexPoint[] = [];
  let index = 1;
  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i]!;
    if (i > 0) {
      const base = sorted[i - 1]!.value + p.flow;
      if (base > 0.005) index *= p.value / base;
    }
    out.push({ date: p.date, index });
  }
  return out;
}

export interface DrawdownResult {
  /** Baisse maximale pic → creux, en % positif (12.5 = −12,5 %). */
  maxDrawdownPct: number;
  peakDate: string | null;
  troughDate: string | null;
  /** Premier point où l'indice repasse au-dessus du pic, null si pas encore. */
  recoveryDate: string | null;
  /** Écart actuel au plus haut, en % positif. */
  currentDrawdownPct: number;
}

export function maxDrawdown(index: ReadonlyArray<IndexPoint>): DrawdownResult {
  let peak = -Infinity;
  let peakDate: string | null = null;
  let best = { dd: 0, peakDate: null as string | null, troughDate: null as string | null, peak: 0 };
  let recoveryDate: string | null = null;
  for (const p of index) {
    if (p.index > peak) {
      peak = p.index;
      peakDate = p.date;
    }
    const dd = peak > 0 ? (peak - p.index) / peak : 0;
    if (dd > best.dd) {
      best = { dd, peakDate, troughDate: p.date, peak };
      recoveryDate = null;
    } else if (best.troughDate && recoveryDate == null && p.date > best.troughDate && p.index >= best.peak) {
      recoveryDate = p.date;
    }
  }
  const last = index[index.length - 1];
  const current = last && peak > 0 ? Math.max(0, (peak - last.index) / peak) : 0;
  return {
    maxDrawdownPct: best.dd * 100,
    peakDate: best.peakDate,
    troughDate: best.troughDate,
    recoveryDate,
    currentDrawdownPct: current * 100,
  };
}

export interface MonthlyReturn {
  year: number;
  /** 1–12. */
  month: number;
  /** En % (2.5 = +2,5 %). */
  returnPct: number;
}

/**
 * Performance de chaque mois calendaire : dernier indice du mois / dernier
 * indice du mois précédent. Le premier mois part du premier point (mois partiel).
 */
export function monthlyReturns(index: ReadonlyArray<IndexPoint>): MonthlyReturn[] {
  const sorted = [...index].sort((a, b) => a.date.localeCompare(b.date));
  const lastByMonth = new Map<string, number>();
  for (const p of sorted) lastByMonth.set(p.date.slice(0, 7), p.index);
  const out: MonthlyReturn[] = [];
  let prev = sorted[0]?.index ?? 1;
  for (const [key, value] of lastByMonth) {
    const [y, m] = key.split('-').map(Number);
    out.push({ year: y!, month: m!, returnPct: prev > 0 ? (value / prev - 1) * 100 : 0 });
    prev = value;
  }
  return out;
}

/** Indice au dernier point ≤ date (null si aucun). */
export function indexAt(index: ReadonlyArray<IndexPoint>, date: string): IndexPoint | null {
  let found: IndexPoint | null = null;
  for (const p of index) if (p.date <= date && (!found || p.date >= found.date)) found = p;
  return found;
}

export interface PeriodReturn {
  /** En %, null si aucun point dans la période. */
  returnPct: number | null;
  /** Vrai si l'historique commence après le début de la période. */
  partial: boolean;
  from: string | null;
  to: string | null;
}

/** TWR entre la fin du jour `from` et la fin du jour `to` (bornes incluses côté fin). */
export function periodReturn(index: ReadonlyArray<IndexPoint>, from: string, to: string): PeriodReturn {
  const sorted = [...index].sort((a, b) => a.date.localeCompare(b.date));
  const end = indexAt(sorted, to);
  if (!end || end.date <= from) return { returnPct: null, partial: false, from: null, to: null };
  const start = indexAt(sorted, from);
  const base = start ?? sorted[0]!;
  return {
    returnPct: base.index > 0 ? (end.index / base.index - 1) * 100 : null,
    partial: start == null,
    from: base.date,
    to: end.date,
  };
}

/** TWR annualisé sur toute la série (null sous un an d'historique). */
export function annualizedTwr(index: ReadonlyArray<IndexPoint>): number | null {
  if (index.length < 2) return null;
  const sorted = [...index].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const days = (Date.parse(`${last.date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${first.date.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  if (days < 365 || first.index <= 0) return null;
  return ((last.index / first.index) ** (365 / days) - 1) * 100;
}
