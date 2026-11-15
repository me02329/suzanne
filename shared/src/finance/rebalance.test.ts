import { describe, expect, it } from 'vitest';
import { ALLOCATION_PRESETS, rebalance } from './rebalance';

const current = { cash: 4_000, bonds: 1_000, equities: 5_000, real_estate: 0, alternative: 0 };

describe('rebalance', () => {
  it('écarts à la cible et versement dirigé vers les classes sous la cible', () => {
    const rows = rebalance(current, ALLOCATION_PRESETS.balanced, 1_000);
    const by = Object.fromEntries(rows.map((r) => [r.bucket, r]));
    expect(by.cash!.gap).toBe(3_000);          // 40 % au lieu de 10 % de 10 000
    expect(by.bonds!.gap).toBe(-2_500);
    expect(by.cash!.deposit).toBe(0);          // déjà au-dessus : rien
    const total = rows.reduce((s, r) => s + r.deposit, 0);
    expect(total).toBe(1_000);                // tout le versement est réparti, au centime
    expect(by.bonds!.deposit).toBeGreaterThan(by.equities!.deposit);
  });

  it('versement plus grand que les manques : le surplus suit la cible', () => {
    const rows = rebalance({ cash: 0, bonds: 0, equities: 0, real_estate: 0, alternative: 0 }, ALLOCATION_PRESETS.dynamic, 1_000);
    expect(rows.find((r) => r.bucket === 'equities')!.deposit).toBe(650);
    expect(rows.reduce((s, r) => s + r.deposit, 0)).toBeCloseTo(1_000, 2);
  });
});
