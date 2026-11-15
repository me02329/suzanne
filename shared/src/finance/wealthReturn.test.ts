import { describe, expect, it } from 'vitest';
import { wealthReturn } from './wealthReturn';

describe('wealthReturn', () => {
  it('sans versement : le rendement est la croissance de la valeur', () => {
    const r = wealthReturn([{ date: '2024-01-01', value: 10_000 }, { date: '2024-12-31', value: 10_500 }], [], '2025-01-01', 10_500);
    expect(r.annualized).toBeCloseTo(5, 0);
    expect(r.gain).toBe(500);
    expect(r.netDeposits).toBe(0);
    expect(r.byYear.find((y) => y.year === '2024')!.pct).toBeCloseTo(5, 1);
  });

  it('les versements ne sont pas du rendement', () => {
    // 1 000 € au départ, +1 000 € versés en juillet, valeur finale 2 060 € : 60 € de gain.
    const r = wealthReturn(
      [{ date: '2025-01-01', value: 1_000 }, { date: '2025-07-01', value: 2_020 }],
      [{ date: '2025-07-01', amount: 1_000 }],
      '2025-12-31',
      2_060,
    );
    expect(r.gain).toBe(60);
    expect(r.netDeposits).toBe(1_000);
    expect(r.annualized).toBeGreaterThan(3);
    expect(r.annualized).toBeLessThan(5);
    expect(r.byYear[0]!.pct).toBeCloseTo(4, 0);
  });

  it('sans historique : rien de calculable', () => {
    expect(wealthReturn([], [], '2025-01-01', 0)).toMatchObject({ annualized: null, since: null, byYear: [] });
  });
});
