const round2 = (value: number) => Math.round(value * 100) / 100;

export type ChartScaleMode = 'linear' | 'symlog' | 'base100';

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

export function toBase100<T extends Record<string, unknown>>(rows: T[], keys: string[]): T[] {
  // For each series, the first row index holding a real (non-zero) value, used
  // as the 100 base. Rows before it are left as gaps (null) rather than 0, so a
  // late-starting account begins its line at 100 instead of spiking up from 0.
  const baseInfo = new Map<string, { base: number; index: number }>();
  for (const key of keys) {
    const index = rows.findIndex((row) => {
      const value = row[key];
      return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) > 0.000001;
    });
    if (index >= 0) baseInfo.set(key, { base: rows[index]![key] as number, index });
  }

  return rows.map((row, rowIndex) => {
    const next: Record<string, unknown> = { ...row };
    for (const key of keys) {
      const value = row[key];
      const info = baseInfo.get(key);
      next[`${key}__raw`] = value;
      if (info == null || rowIndex < info.index || typeof value !== 'number' || !Number.isFinite(value)) {
        next[key] = null; // before the series exists, or no real value at all
      } else {
        next[key] = round2((value / info.base) * 100);
      }
    }
    return next as T;
  });
}

export function symlog(value: number, constant: number): number {
  if (!Number.isFinite(value)) return value;
  const c = Math.max(1, constant);
  return Math.sign(value) * Math.log10(1 + Math.abs(value) / c);
}

export function symlogInverse(value: number, constant: number): number {
  if (!Number.isFinite(value)) return value;
  const c = Math.max(1, constant);
  return Math.sign(value) * c * (10 ** Math.abs(value) - 1);
}

export function symlogConstant(values: number[]): number {
  const positive = values.map((value) => Math.abs(value)).filter((value) => Number.isFinite(value) && value > 0);
  if (positive.length === 0) return 100;
  positive.sort((a, b) => a - b);
  const mid = positive[Math.floor(positive.length / 2)] ?? 100;
  // Keep a useful near-zero linear-ish area without making large accounts flat.
  return Math.max(1, round2(mid / 10));
}

export function toSymlog<T extends Record<string, unknown>>(rows: T[], keys: string[], constant: number): T[] {
  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const key of keys) {
      const value = row[key];
      next[`${key}__raw`] = value;
      next[key] = typeof value === 'number' && Number.isFinite(value) ? round2(symlog(value, constant)) : null;
    }
    return next as T;
  });
}
