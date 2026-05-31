const round2 = (value: number) => Math.round(value * 100) / 100;

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
