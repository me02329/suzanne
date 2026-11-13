import { describe, expect, it } from 'vitest';
import { buildTracking, fridayOnOrAfter, fridaysBetween, monthlyFlows } from './tracking.js';

describe('vendredis (UTC)', () => {
  it('fridayOnOrAfter', () => {
    expect(fridayOnOrAfter('2024-03-01')).toBe('2024-03-01'); // vendredi
    expect(fridayOnOrAfter('2024-03-02')).toBe('2024-03-08');
    expect(fridayOnOrAfter('2024-03-31')).toBe('2024-04-05'); // passage à l'heure d'été sans effet
  });
  it('fridaysBetween', () => {
    expect(fridaysBetween('2024-10-21', '2024-11-08')).toEqual(['2024-10-25', '2024-11-01', '2024-11-08']);
    expect(fridaysBetween('2024-11-09', '2024-11-14')).toEqual([]);
  });
});

describe('buildTracking', () => {
  it('cumule les versements et isole la variation de marché', () => {
    const rows = buildTracking(
      [
        { date: '2024-01-05', value: 1000 },
        { date: '2024-01-12', value: 1550 },
        { date: '2024-01-19', value: 1500 },
      ],
      [
        { date: '2024-01-02', amount: 1000 },
        { date: '2024-01-10', amount: 500 },
      ],
    );
    expect(rows[0]).toMatchObject({ cumulatedDeposits: 1000, flow: 1000, gain: 0, change: null });
    expect(rows[1]).toMatchObject({ cumulatedDeposits: 1500, flow: 500, gain: 50, change: 50 });
    expect(rows[1]!.changePct).toBeCloseTo(50 / 1500 * 100, 6);
    expect(rows[2]).toMatchObject({ flow: 0, gain: 0, change: -50 });
    expect(rows[2]!.gainPct).toBe(0);
  });

  it('retraits inclus dans le net', () => {
    const rows = buildTracking([{ date: '2024-02-02', value: 700 }], [
      { date: '2024-01-02', amount: 1000 },
      { date: '2024-01-20', amount: -300 },
    ]);
    expect(rows[0]!.cumulatedDeposits).toBe(700);
  });
});

describe('monthlyFlows', () => {
  it('comble les mois sans versement et cumule', () => {
    const m = monthlyFlows([
      { date: '2024-11-15', amount: 200 },
      { date: '2025-01-03', amount: 300 },
      { date: '2025-01-20', amount: -100 },
    ], '2025-02-10');
    expect(m.map((r) => r.month)).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
    expect(m[2]).toMatchObject({ deposits: 300, withdrawals: 100, net: 200, cumulative: 400 });
    expect(m[3]!.cumulative).toBe(400);
  });
  it('vide', () => {
    expect(monthlyFlows([])).toEqual([]);
  });
});
