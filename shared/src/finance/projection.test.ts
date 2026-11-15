import { describe, expect, it } from 'vitest';
import { blendedRate, doublingYears, projectWealth, TYPICAL_RETURNS } from './projection';

const zero = { cash: 0, bonds: 0, equities: 0, real_estate: 0, alternative: 0 };

describe('projection', () => {
  it('chaque classe croît à son rythme, versements répartis selon les poids', () => {
    const years = projectWealth({
      start: { ...zero, cash: 1_000, equities: 1_000 },
      rates: TYPICAL_RETURNS,
      monthly: 100,
      split: { ...zero, equities: 1 },
      years: 10,
    });
    expect(years).toHaveLength(11);
    expect(years[0]!.total).toBe(2_000);
    expect(years[10]!.byBucket.cash).toBeCloseTo(1_000 * 1.02 ** 10, 0);
    expect(years[10]!.byBucket.equities).toBeGreaterThan(1_000 * 1.07 ** 10 + 12_000);
    expect(years[10]!.contributed).toBe(14_000);
  });

  it('scénario : versement supplémentaire en actions', () => {
    const base = projectWealth({ start: zero, rates: TYPICAL_RETURNS, monthly: 0, split: zero, years: 5 });
    const more = projectWealth({ start: zero, rates: TYPICAL_RETURNS, monthly: 0, split: zero, years: 5, extraEquities: 200 });
    expect(base[5]!.total).toBe(0);
    expect(more[5]!.total).toBeGreaterThan(12_000);
  });

  it('taux moyen et règle de 72', () => {
    expect(blendedRate({ ...zero, cash: 500, equities: 500 }, TYPICAL_RETURNS)).toBeCloseTo(0.045);
    expect(doublingYears(0.07)).toBeCloseTo(10.29, 1);
    expect(doublingYears(0)).toBeNull();
  });
});
