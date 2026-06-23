import { describe, it, expect } from 'vitest';
import { positionStats, valuePosition, type OrderLike } from './holdings';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const buy = (date: string, quantity: number, unit_price: number, fee = 0): OrderLike => ({ side: 'buy', date: d(date), quantity, unit_price, fee });
const sell = (date: string, quantity: number, unit_price: number, fee = 0): OrderLike => ({ side: 'sell', date: d(date), quantity, unit_price, fee });

describe('positionStats', () => {
  it('aggregates buys with weighted average cost (fees included)', () => {
    const s = positionStats([buy('2024-01-01', 10, 100, 5), buy('2024-02-01', 10, 120, 5)]);
    expect(s.quantity).toBe(20);
    expect(s.cost_basis).toBe(2210); // 1005 + 1205
    expect(s.avg_cost).toBeCloseTo(110.5);
    expect(s.realized_pnl).toBe(0);
  });

  it('realizes P&L on a sell at the running average cost', () => {
    // achat 10@100 (PRU 100), vente 4@150 frais 2 → réalisé = (600-2) - 400 = 198
    const s = positionStats([buy('2024-01-01', 10, 100), sell('2024-03-01', 4, 150, 2)]);
    expect(s.quantity).toBe(6);
    expect(s.cost_basis).toBe(600);   // 6 × PRU 100
    expect(s.avg_cost).toBe(100);
    expect(s.realized_pnl).toBe(198);
  });

  it('respects the asOf cutoff', () => {
    const orders = [buy('2024-01-01', 10, 100), buy('2024-06-01', 5, 200)];
    expect(positionStats(orders, d('2024-03-01')).quantity).toBe(10);
    expect(positionStats(orders, d('2024-07-01')).quantity).toBe(15);
  });

  it('flattens to zero when fully sold', () => {
    const s = positionStats([buy('2024-01-01', 10, 100), sell('2024-02-01', 10, 130)]);
    expect(s.quantity).toBe(0);
    expect(s.cost_basis).toBe(0);
    expect(s.avg_cost).toBe(0);
    expect(s.realized_pnl).toBe(300);
  });
});

describe('valuePosition', () => {
  it('computes market value and unrealized P&L', () => {
    const s = positionStats([buy('2024-01-01', 10, 100)]);
    const v = valuePosition(s, 150);
    expect(v.market_value).toBe(1500);
    expect(v.unrealized_pnl).toBe(500);
  });

  it('falls back to cost basis when the price is unavailable', () => {
    const s = positionStats([buy('2024-01-01', 10, 100)]);
    const v = valuePosition(s, null);
    expect(v.market_value).toBe(1000);
    expect(v.unrealized_pnl).toBe(0);
  });
});
