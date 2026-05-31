const round2 = (value: number) => Math.round(value * 100) / 100;

export type ChartScaleMode = 'linear' | 'log' | 'base100';

// Y-axis domain that fits a balance/trend series instead of always anchoring at
// zero, so small variations far from zero (100 → 101 → 110) stay visible
// instead of flattening into a line. Pads by `pad` of the data range on each
// side. A one-sided series never plunges across zero: when a positive series
// reaches down toward 0 (e.g. after enabling an account sitting at 0), we keep
// the floor just below zero — 5% of the range of air — so the line isn't glued
// to the bottom edge, rather than padding a full 12% into negative territory.
export function fitDomain(values: number[], pad = 0.12): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [0, 1];

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    const p = Math.abs(min) * 0.1 || 1;
    return [round2(min - p), round2(max + p)];
  }

  const range = max - min;
  let lo = min - range * pad;
  let hi = max + range * pad;
  if (min >= 0 && lo < 0) lo = -range * 0.05; // positive series: 5% air below 0
  if (max <= 0 && hi > 0) hi = range * 0.05;  // negative series: 5% air above 0
  return [round2(lo), round2(hi)];
}

// True logarithmic axes cannot display 0 or negative values. Keep this check
// scoped to the visible values so users can hide liabilities/empty accounts and
// still use the log view.
export function canUseLogScale(values: number[]): boolean {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length > 0 && finite.every((value) => value > 0);
}

export function fitPositiveLogDomain(values: number[]): [number, number] {
  const positive = values.filter((value) => Number.isFinite(value) && value > 0);
  if (positive.length === 0) return [1, 10];
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  if (min === max) {
    return [round2(Math.max(min / 1.5, Number.MIN_VALUE)), round2(max * 1.5)];
  }
  return [round2(Math.max(min / 1.15, Number.MIN_VALUE)), round2(max * 1.15)];
}

export function toBase100<T extends Record<string, unknown>>(rows: T[], keys: string[]): T[] {
  const bases = new Map<string, number>();
  for (const key of keys) {
    const first = rows
      .map((row) => row[key])
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 0.000001);
    if (first != null) bases.set(key, first);
  }

  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const key of keys) {
      const value = row[key];
      const base = bases.get(key);
      next[`${key}__raw`] = value;
      if (typeof value === 'number' && Number.isFinite(value) && base != null) {
        next[key] = round2((value / base) * 100);
      } else {
        next[key] = null;
      }
    }
    return next as T;
  });
}
