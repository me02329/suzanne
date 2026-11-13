import { describe, expect, it } from 'vitest';
import { annualizedTwr, maxDrawdown, monthlyReturns, periodReturn, twrIndex } from './twr.js';
import { buildTracking, trackingToFlowPoints } from './tracking.js';

describe('twrIndex', () => {
  it('neutralise les versements', () => {
    const idx = twrIndex([
      { date: '2024-01-05', value: 1000, flow: 1000 },
      { date: '2024-01-12', value: 2100, flow: 1000 }, // +5 % sur 2000
      { date: '2024-01-19', value: 2100, flow: 0 },
    ]);
    expect(idx[0]!.index).toBe(1);
    expect(idx[1]!.index).toBeCloseTo(1.05, 10);
    expect(idx[2]!.index).toBeCloseTo(1.05, 10);
  });

  it('ignore les périodes à base nulle', () => {
    const idx = twrIndex([
      { date: '2024-01-05', value: 0, flow: 0 },
      { date: '2024-01-12', value: 500, flow: 500 },
    ]);
    expect(idx[1]!.index).toBe(1);
  });
});

describe('maxDrawdown (sur TWR)', () => {
  it('voit une baisse masquée par un versement (bug njord)', () => {
    // −10 % de marché la 2e semaine, compensé en valeur brute par un versement.
    const rows = buildTracking(
      [
        { date: '2024-01-05', value: 10_000 },
        { date: '2024-01-12', value: 10_000 },
        { date: '2024-01-19', value: 10_000 },
      ],
      [
        { date: '2024-01-05', amount: 10_000 },
        { date: '2024-01-12', amount: 1_000 }, // 11 000 − 10 % ≈ 9 900… ici 10 000 → −9,09 %
      ],
    );
    const dd = maxDrawdown(twrIndex(trackingToFlowPoints(rows)));
    expect(dd.maxDrawdownPct).toBeCloseTo((1 - 10_000 / 11_000) * 100, 6);
    expect(dd.peakDate).toBe('2024-01-05');
    expect(dd.troughDate).toBe('2024-01-12');
    expect(dd.recoveryDate).toBeNull();
  });

  it('pic → creux → rétablissement', () => {
    const dd = maxDrawdown([
      { date: '2024-01-01', index: 1 },
      { date: '2024-02-01', index: 2 },
      { date: '2024-03-01', index: 1.5 },
      { date: '2024-04-01', index: 1.8 },
      { date: '2024-05-01', index: 2.1 },
    ]);
    expect(dd.maxDrawdownPct).toBeCloseTo(25, 6);
    expect(dd.peakDate).toBe('2024-02-01');
    expect(dd.troughDate).toBe('2024-03-01');
    expect(dd.recoveryDate).toBe('2024-05-01');
    expect(dd.currentDrawdownPct).toBe(0);
  });

  it('nul sur une série croissante', () => {
    expect(maxDrawdown([{ date: '2024-01-01', index: 1 }, { date: '2024-02-01', index: 1.1 }]).maxDrawdownPct).toBe(0);
  });
});

describe('monthlyReturns', () => {
  it('chaîne les fins de mois, premier mois partiel', () => {
    const r = monthlyReturns([
      { date: '2024-01-05', index: 1 },
      { date: '2024-01-26', index: 1.02 },
      { date: '2024-02-02', index: 1.0 },
      { date: '2024-02-23', index: 1.071 },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ year: 2024, month: 1 });
    expect(r[0]!.returnPct).toBeCloseTo(2, 6);
    expect(r[1]!.month).toBe(2);
    expect(r[1]!.returnPct).toBeCloseTo((1.071 / 1.02 - 1) * 100, 6);
  });
});

describe('periodReturn / annualizedTwr', () => {
  const idx = [
    { date: '2022-06-03', index: 1 },
    { date: '2022-12-30', index: 1.1 },
    { date: '2023-12-29', index: 1.21 },
  ];
  it('année complète', () => {
    const r = periodReturn(idx, '2022-12-31', '2023-12-31');
    expect(r.returnPct).toBeCloseTo(10, 6);
    expect(r.partial).toBe(false);
  });
  it('année partielle', () => {
    const r = periodReturn(idx, '2021-12-31', '2022-12-31');
    expect(r.returnPct).toBeCloseTo(10, 6);
    expect(r.partial).toBe(true);
  });
  it('rien dans la période', () => {
    expect(periodReturn(idx, '2024-12-31', '2025-12-31').returnPct).toBeNull();
  });
  it('annualisé seulement au-delà d’un an', () => {
    expect(annualizedTwr(idx.slice(0, 2))).toBeNull();
    expect(annualizedTwr(idx)).toBeGreaterThan(0);
  });
});
