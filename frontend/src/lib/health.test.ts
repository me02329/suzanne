import { describe, expect, it } from 'vitest';
import type { Budget, Category, DashboardSummary, RecurringTransaction } from '@suzanne-lite/shared';
import { computeHealth } from './health';

type Cashflow = DashboardSummary['monthly_cashflow'];

function month(m: string, income: number, expenses: number): Cashflow[number] {
  const net = income - expenses;
  return { month: m, income, expenses, expenses_signed: -expenses, net, cumulative_net: net };
}

function recurring(overrides: Partial<RecurringTransaction>): RecurringTransaction {
  return {
    id: 1, user_id: 1, account_id: null, category_id: null, amount: 100, type: 'expense',
    description: 'Abo', frequency: 'monthly', interval: 1, day_of_month: 1, active: true,
    last_executed: null, created_at: '2025-01-01T00:00:00.000Z', ...overrides,
  };
}

const noBudgets: Budget[] = [];
const categoryById = new Map<number, Category>([
  [1, { id: 1, user_id: 1, name: 'Courses', type: 'expense', color: '#000', icon: null, created_at: '' }],
]);

describe('computeHealth', () => {
  it('computes savings rate from months that had income', () => {
    const h = computeHealth({
      monthlyCashflow: [month('2026-01', 2000, 1500), month('2026-02', 2000, 1000), month('2026-03', 0, 0)],
      liquidBalance: 0,
      recurring: [],
      budgets: noBudgets,
      expensesByCategory: [],
      categoryById,
      rateFor: () => 1,
    });
    // Series excludes the empty month; current = latest (Feb) = 1000/2000 = 0.5.
    expect(h.savingsRate.series.map((p) => p.month)).toEqual(['2026-01', '2026-02']);
    expect(h.savingsRate.current).toBeCloseTo(0.5);
    expect(h.savingsRate.average).toBeCloseTo((0.25 + 0.5) / 2);
    expect(h.savingsRate.rating).toBe('good');
  });

  it('rates emergency fund by months of expenses covered', () => {
    const h = computeHealth({
      monthlyCashflow: [month('2026-01', 0, 1000), month('2026-02', 0, 1000)],
      liquidBalance: 7000,
      recurring: [],
      budgets: noBudgets,
      expensesByCategory: [],
      categoryById,
      rateFor: () => 1,
    });
    expect(h.emergencyFund.avgMonthlyExpenses).toBe(1000);
    expect(h.emergencyFund.monthsCovered).toBe(7);
    expect(h.emergencyFund.rating).toBe('good');
  });

  it('sums active expense recurring into the fixed monthly load and applies fx', () => {
    const h = computeHealth({
      monthlyCashflow: [month('2026-01', 2000, 1500)],
      liquidBalance: 0,
      recurring: [
        recurring({ id: 1, amount: 300, frequency: 'monthly', type: 'expense' }),
        recurring({ id: 2, amount: 120, frequency: 'yearly', type: 'expense' }), // 10/month
        recurring({ id: 3, amount: 500, type: 'income' }), // ignored (income)
        recurring({ id: 4, amount: 999, active: false }), // ignored (inactive)
      ],
      budgets: noBudgets,
      expensesByCategory: [],
      categoryById,
      rateFor: () => 1,
    });
    expect(h.recurringLoad.monthlyFixed).toBe(310);
    expect(h.recurringLoad.share).toBeCloseTo(310 / 2000);
    expect(h.fixedVsVariable.fixed).toBe(310);
    expect(h.fixedVsVariable.variable).toBe(1190); // 1500 avg expenses - 310 fixed
  });

  it('measures budget adherence for the current month', () => {
    const budgets: Budget[] = [
      { id: 1, user_id: 1, category_id: 1, month: '2026-01', amount_limit: 400, created_at: '' },
    ];
    const h = computeHealth({
      monthlyCashflow: [month('2026-01', 2000, 1500)],
      liquidBalance: 0,
      recurring: [],
      budgets,
      expensesByCategory: [{ category_id: 1, name: 'Courses', color: '#000', amount: 450 }],
      categoryById,
      rateFor: () => 1,
    });
    expect(h.budgetAdherence).not.toBeNull();
    expect(h.budgetAdherence!.overCount).toBe(1);
    expect(h.budgetAdherence!.items[0]).toMatchObject({ name: 'Courses', spent: 450, limit: 400, over: true });
  });

  it('returns null adherence and unknown ratings without data', () => {
    const h = computeHealth({
      monthlyCashflow: [],
      liquidBalance: 0,
      recurring: [],
      budgets: noBudgets,
      expensesByCategory: [],
      categoryById,
      rateFor: () => 1,
    });
    expect(h.budgetAdherence).toBeNull();
    expect(h.savingsRate.rating).toBe('unknown');
    expect(h.emergencyFund.rating).toBe('unknown');
  });
});
