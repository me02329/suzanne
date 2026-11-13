import { describe, it, expect } from 'vitest';
import { xirr, annualizedMoneyWeightedReturn } from './xirr.js';

describe('xirr', () => {
  it('returns null with fewer than two flows', () => {
    expect(xirr([{ date: '2024-01-01', amount: -100 }])).toBeNull();
  });

  it('returns null when all flows share the same sign', () => {
    expect(
      xirr([
        { date: '2024-01-01', amount: -100 },
        { date: '2024-06-01', amount: -100 },
      ]),
    ).toBeNull();
  });

  it('solves a simple one-year doubling to 100 %', () => {
    // 2023 is not a leap year → exactly 365 days, so Actual/365 gives exactly 100 %.
    const rate = xirr([
      { date: '2023-01-01', amount: -100 },
      { date: '2024-01-01', amount: 200 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(100, 1);
  });

  it('handles a flat investment (0 % return)', () => {
    const rate = xirr([
      { date: '2024-01-01', amount: -1000 },
      { date: '2025-01-01', amount: 1000 },
    ]);
    expect(rate!).toBeCloseTo(0, 4);
  });

  it('returns a negative rate on a loss', () => {
    const rate = xirr([
      { date: '2024-01-01', amount: -1000 },
      { date: '2025-01-01', amount: 900 },
    ]);
    expect(rate!).toBeLessThan(0);
    expect(rate!).toBeCloseTo(-10, 1);
  });

  it('weights by timing: late contributions barely move the annualized rate', () => {
    // 1000 invested for a year doubles; 1000 added the day before valuation does not.
    const rate = xirr([
      { date: '2024-01-01', amount: -1000 },
      { date: '2024-12-31', amount: -1000 },
      { date: '2025-01-01', amount: 3000 },
    ]);
    // Simple gain would be (3000-2000)/2000 = 50 %, but money-weighted is much higher
    // because half the capital was only invested for a day.
    expect(rate!).toBeGreaterThan(60);
  });
});

describe('annualizedMoneyWeightedReturn', () => {
  it('returns null without contributions or value', () => {
    expect(annualizedMoneyWeightedReturn([], 1000)).toBeNull();
    expect(annualizedMoneyWeightedReturn([{ date: '2024-01-01', amount: 100 }], 0)).toBeNull();
  });

  it('builds contribution outflows + terminal value inflow', () => {
    const rate = annualizedMoneyWeightedReturn(
      [{ date: '2023-01-01', amount: 100 }],
      200,
      '2024-01-01',
    );
    expect(rate!).toBeCloseTo(100, 1);
  });
});
