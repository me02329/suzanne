import { describe, expect, it } from 'vitest';
import type { RecurringTransaction } from '@suzanne/shared';
import { cadenceAmount, cadenceOf, cadenceTotals, groupByCadence } from './subscriptions';

function recurring(overrides: Partial<RecurringTransaction>): RecurringTransaction {
  return {
    id: 1, user_id: 1, account_id: null, category_id: null, amount: 100, type: 'expense',
    description: 'Test', frequency: 'monthly', interval: 1, day_of_month: 1, month_of_year: null, active: true,
    last_executed: null, created_at: '',
    ...overrides,
  };
}

describe('cadenceOf', () => {
  it('classifies each frequency, treating "every N months" as periodic', () => {
    expect(cadenceOf(recurring({ frequency: 'monthly', interval: 1 }))).toBe('monthly');
    expect(cadenceOf(recurring({ frequency: 'monthly', interval: 3 }))).toBe('periodic');
    expect(cadenceOf(recurring({ frequency: 'yearly', interval: 1 }))).toBe('periodic');
    expect(cadenceOf(recurring({ frequency: 'weekly', interval: 1 }))).toBe('weekly');
  });
});

describe('cadenceAmount', () => {
  it('keeps a monthly amount as its per-month value', () => {
    expect(cadenceAmount(recurring({ frequency: 'monthly', amount: 15.99 }))).toBe(15.99);
  });

  it('keeps a yearly amount as its yearly value (never divided by 12)', () => {
    expect(cadenceAmount(recurring({ frequency: 'yearly', amount: 540 }))).toBe(540);
  });

  it('annualises "every N months" into a yearly figure', () => {
    // every 3 months -> 4 payments a year
    expect(cadenceAmount(recurring({ frequency: 'monthly', interval: 3, amount: 120 }))).toBe(480);
  });

  it('expresses weekly per week, dividing by the interval', () => {
    expect(cadenceAmount(recurring({ frequency: 'weekly', amount: 15 }))).toBe(15);
    expect(cadenceAmount(recurring({ frequency: 'weekly', amount: 30, interval: 2 }))).toBe(15);
  });
});

describe('groupByCadence', () => {
  const rate = () => 1;

  it('orders groups monthly > periodic > weekly and totals active rows only', () => {
    const groups = groupByCadence([
      recurring({ id: 1, frequency: 'weekly', amount: 15 }),
      recurring({ id: 2, frequency: 'monthly', amount: 800 }),
      recurring({ id: 3, frequency: 'yearly', amount: 540 }),
      recurring({ id: 4, frequency: 'monthly', amount: 16 }),
      recurring({ id: 5, frequency: 'monthly', amount: 999, active: false }), // inactive
    ], rate);

    expect(groups.map((g) => g.cadence)).toEqual(['monthly', 'periodic', 'weekly']);
    const monthly = groups[0]!;
    expect(monthly.total).toBe(816); // 800 + 16, inactive 999 excluded
    expect(monthly.rows.map((r) => r.r.id)).toEqual([2, 4, 5]); // active first by value, inactive last
    expect(groups[1]!.total).toBe(540);
    expect(groups[2]!.total).toBe(15);
  });

  it('converts amounts to the report currency for the totals', () => {
    const groups = groupByCadence([recurring({ account_id: 7, amount: 100 })], (id) => (id === 7 ? 1.1 : 1));
    expect(groups[0]!.total).toBe(110);
  });
});

describe('cadenceTotals', () => {
  it('sums each cadence in its own unit', () => {
    const totals = cadenceTotals([
      recurring({ frequency: 'monthly', amount: 800 }),
      recurring({ frequency: 'monthly', amount: 16 }),
      recurring({ frequency: 'yearly', amount: 540 }),
      recurring({ frequency: 'weekly', amount: 15 }),
    ], () => 1);
    expect(totals).toEqual({ monthly: 816, periodic: 540, weekly: 15 });
  });
});
