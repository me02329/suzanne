import { describe, expect, it } from 'vitest';
import type { RecurringTransaction, SavingsGoal } from '@suzanne-lite/shared';
import { buildForecast } from './forecast';

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
