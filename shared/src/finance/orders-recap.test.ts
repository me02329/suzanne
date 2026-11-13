import { describe, expect, it } from 'vitest';
import { buildOrderBook, orderBookTotals } from './orders.js';
import { availableYears, buildYearRecap } from './recap.js';
import { twrIndex } from './twr.js';

const holdings = [
  {
    id: 1, symbol: 'CW8.PA', name: 'CW8', currency: 'EUR',
    orders: [
      { id: 1, date: '2023-02-01', side: 'buy' as const, quantity: 10, unit_price: 100, fee: 2 },
      { id: 2, date: '2023-08-01', side: 'buy' as const, quantity: 10, unit_price: 120, fee: 2 },
      { id: 3, date: '2024-03-01', side: 'sell' as const, quantity: 5, unit_price: 150, fee: 1 },
    ],
  },
];

describe('buildOrderBook', () => {
  it('plus-value réalisée au PRU (frais inclus)', () => {
    const rows = buildOrderBook(holdings);
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
    const sell = rows[0]!;
    // PRU = (1002 + 1202) / 20 = 110,2 → 5 × 150 − 1 − 551 = 198
    expect(sell.avgCostBefore).toBeCloseTo(110.2, 10);
    expect(sell.realizedPnl).toBe(198);
    expect(sell.total).toBe(749);
    expect(sell.quantityAfter).toBe(15);
    expect(rows[1]!.realizedPnl).toBeNull();
    expect(rows[1]!.total).toBe(1202);
  });

  it('totaux', () => {
    const t = orderBookTotals(buildOrderBook(holdings));
    expect(t).toMatchObject({ buys: 2204, buyCount: 2, sells: 749, sellCount: 1, fees: 5, realizedPnl: 198 });
  });
});

describe('buildYearRecap', () => {
  const flows = [
    { date: '2023-01-15', amount: 1100 },
    { date: '2023-07-20', amount: 1300 },
    { date: '2024-02-10', amount: 500 },
  ];
  const values = [
    { date: '2023-01-20', value: 1100 },
    { date: '2023-12-29', value: 2600 },
    { date: '2024-06-28', value: 3400 },
  ];
  const points = [
    { date: '2023-01-20', value: 1100, flow: 1100 },
    { date: '2023-12-29', value: 2600, flow: 1300 },
    { date: '2024-06-28', value: 3400, flow: 500 },
  ];
  const index = twrIndex(points);
  const orders = buildOrderBook(holdings);

  it('année avec vente et revenus', () => {
    const r = buildYearRecap({ year: 2024, flows, orders, values, index, incomes: [{ date: '2024-05-02', amount: 12.5 }], asOf: '2024-07-01' });
    expect(r).toMatchObject({ deposits: 500, depositCount: 1, sells: 749, sellCount: 1, realizedPnl: 198, income: 12.5, startValue: 2600, endValue: 3400, gain: 300, partial: false });
    expect(r.twrPct).toBeCloseTo((3400 / 3100 - 1) * 100, 6);
    expect(r.byHolding[0]).toMatchObject({ symbol: 'CW8.PA', sells: 749 });
  });

  it('première année partielle', () => {
    const r = buildYearRecap({ year: 2023, flows, orders, values, index, asOf: '2024-07-01' });
    expect(r.startValue).toBe(0);
    expect(r.partial).toBe(true);
    expect(r.buys).toBe(2204);
    expect(r.gain).toBe(200);
  });

  it('availableYears', () => {
    expect(availableYears(['2023-01-01', '2024-05-01', '2023-06-01'])).toEqual([2024, 2023]);
  });
});
