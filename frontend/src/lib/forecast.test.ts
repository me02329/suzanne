import { describe, expect, it } from 'vitest';
import type { RecurringTransaction, SavingsGoal } from '@suzanne-lite/shared';
import { buildForecast, groupForecastEvents, type ForecastEvent } from './forecast';

const NOW = new Date('2026-01-01T12:00:00.000Z');

function recurring(overrides: Partial<RecurringTransaction>): RecurringTransaction {
  return {
    id: 1,
    user_id: 1,
    account_id: null,
    category_id: null,
    amount: 100,
    type: 'expense',
    description: 'Test',
    frequency: 'monthly',
    interval: 1,
    day_of_month: 1,
    month_of_year: null,
    active: true,
    last_executed: null,
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function goal(overrides: Partial<SavingsGoal>): SavingsGoal {
  return {
    id: 1,
    user_id: 1,
    account_id: null,
    name: 'Objectif',
    target_amount: 1000,
    current_amount: 300,
    deadline: null,
    color: '#000000',
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildForecast', () => {
  it('expands a weekly expense and walks the running balance down', () => {
    const f = buildForecast({
      horizonDays: 30,
      startingBalance: 1000,
      recurring: [recurring({ frequency: 'weekly', amount: 100, type: 'expense' })],
      goals: [],
      rateFor: () => 1,
      now: NOW,
    });

    expect(f.from).toBe('2026-01-01');
    expect(f.to).toBe('2026-01-31');
    expect(f.events.map((e) => e.date)).toEqual(['2026-01-08', '2026-01-15', '2026-01-22', '2026-01-29']);
    expect(f.events.map((e) => e.runningBalance)).toEqual([900, 800, 700, 600]);
    expect(f.endingBalance).toBe(600);
    expect(f.lowestBalance).toBe(600);
    expect(f.lowestDate).toBe('2026-01-29');
    expect(f.totalExpenses).toBe(400);
    expect(f.totalIncome).toBe(0);
    // Step series: today + one point per event date + flat extension to horizon.
    expect(f.series[0]).toEqual({ date: '2026-01-01', balance: 1000 });
    expect(f.series[f.series.length - 1]).toEqual({ date: '2026-01-31', balance: 600 });
  });

  it('applies the fx rate to amounts in a foreign account currency', () => {
    const f = buildForecast({
      horizonDays: 30,
      startingBalance: 0,
      recurring: [recurring({ frequency: 'weekly', amount: 100, type: 'income', account_id: 7 })],
      goals: [],
      rateFor: (id) => (id === 7 ? 1.1 : 1),
      now: NOW,
    });
    expect(f.events[0]!.amount).toBe(110);
    expect(f.events[0]!.signed).toBe(110);
  });

  it('ignores inactive recurring', () => {
    const f = buildForecast({
      horizonDays: 60,
      startingBalance: 500,
      recurring: [recurring({ active: false })],
      goals: [],
      rateFor: () => 1,
      now: NOW,
    });
    expect(f.events).toHaveLength(0);
    expect(f.endingBalance).toBe(500);
  });

  it('keeps only goal deadlines falling inside the horizon', () => {
    const f = buildForecast({
      horizonDays: 90,
      startingBalance: 0,
      recurring: [],
      goals: [
        goal({ id: 1, deadline: '2026-02-15', target_amount: 1000, current_amount: 300 }),
        goal({ id: 2, deadline: '2025-12-01' }), // past
        goal({ id: 3, deadline: null }), // none
        goal({ id: 4, deadline: '2026-06-01' }), // beyond horizon
      ],
      rateFor: () => 1,
      now: NOW,
    });
    expect(f.goalDeadlines).toHaveLength(1);
    expect(f.goalDeadlines[0]).toMatchObject({ goalId: 1, deadline: '2026-02-15', remaining: 700 });
  });
});

function event(overrides: Partial<ForecastEvent>): ForecastEvent {
  return {
    date: '2026-01-05',
    recurringId: 1,
    description: 'Test',
    type: 'expense',
    amount: 100,
    signed: -100,
    accountId: null,
    categoryId: null,
    runningBalance: 0,
    ...overrides,
  };
}

describe('groupForecastEvents', () => {
  it('groups contiguous events by week with per-group totals and end balance', () => {
    // 2026-01-05 is a Monday; 2026-01-11 a Sunday; 2026-01-12 the next Monday.
    const groups = groupForecastEvents([
      event({ date: '2026-01-05', type: 'income', amount: 300, signed: 300, runningBalance: 1300 }),
      event({ date: '2026-01-11', type: 'expense', amount: 100, signed: -100, runningBalance: 1200 }),
      event({ date: '2026-01-12', type: 'expense', amount: 50, signed: -50, runningBalance: 1150 }),
    ], 'week');

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      key: '2026-01-05',
      label: 'Semaine du 05/01',
      income: 300,
      expenses: 100,
      net: 200,
      endBalance: 1200,
    });
    expect(groups[0]!.events).toHaveLength(2);
    expect(groups[1]).toMatchObject({ key: '2026-01-12', net: -50, endBalance: 1150 });
  });

  it('groups by calendar month with a French label', () => {
    const groups = groupForecastEvents([
      event({ date: '2026-01-05', runningBalance: 900 }),
      event({ date: '2026-01-28', runningBalance: 800 }),
      event({ date: '2026-02-03', runningBalance: 700 }),
    ], 'month');

    expect(groups.map((g) => g.key)).toEqual(['2026-01', '2026-02']);
    expect(groups[0]!.label).toBe('Janvier 2026');
    expect(groups[0]!.endBalance).toBe(800);
    expect(groups[1]!.endBalance).toBe(700);
  });

  it('preserves the input event order inside groups', () => {
    const groups = groupForecastEvents([
      event({ date: '2026-01-05', recurringId: 1 }),
      event({ date: '2026-01-05', recurringId: 2 }),
    ], 'month');
    expect(groups[0]!.events.map((e) => e.recurringId)).toEqual([1, 2]);
  });

  it('returns no groups for no events', () => {
    expect(groupForecastEvents([], 'week')).toEqual([]);
  });
});
