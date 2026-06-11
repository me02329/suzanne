import {
  recurringMonthlyEquivalent,
  type Budget,
  type Category,
  type DashboardSummary,
  type RecurringTransaction,
} from '@suzanne/shared';

// Derived "financial health" indicators. These are ratios (savings rate,
// emergency-fund coverage, recurring load, budget adherence) rather than the
// raw amounts the dashboard and statistics already show — a complementary,
// at-a-glance read on whether the situation is healthy.

// good = healthy, warn = watch, bad = at risk, unknown = not enough data.
export type HealthRating = 'good' | 'warn' | 'bad' | 'unknown';

export interface SavingsRatePoint {
  month: string;
  rate: number; // fraction, can be negative when overspending
}

export interface BudgetAdherenceItem {
  categoryId: number;
  name: string;
  spent: number;
  limit: number;
  ratio: number;
  over: boolean;
}

export interface HealthMetrics {
  savingsRate: {
    current: number | null;
    average: number | null;
    series: SavingsRatePoint[];
    rating: HealthRating;
  };
  emergencyFund: {
    liquidBalance: number;
    avgMonthlyExpenses: number;
    monthsCovered: number | null;
    rating: HealthRating;
  };
  recurringLoad: {
    monthlyFixed: number;
    avgMonthlyIncome: number;
    share: number | null;
    rating: HealthRating;
  };
  fixedVsVariable: {
    fixed: number;
    variable: number;
  };
  budgetAdherence: {
    budgetedTotal: number;
    spentTotal: number;
    overCount: number;
    withinCount: number;
    items: BudgetAdherenceItem[];
  } | null;
}

export interface HealthInput {
  monthlyCashflow: DashboardSummary['monthly_cashflow'];
  liquidBalance: number;
  recurring: RecurringTransaction[];
  budgets: Budget[];
  expensesByCategory: DashboardSummary['expenses_by_category'];
  categoryById: Map<number, Category>;
  // Converts a recurring amount (account currency) to the report currency.
  rateFor: (accountId: number | null) => number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);

// Higher ratio is healthier (savings rate, emergency fund).
function rateHigherIsBetter(value: number | null, goodAt: number, warnAt: number): HealthRating {
  if (value === null) return 'unknown';
  if (value >= goodAt) return 'good';
  if (value >= warnAt) return 'warn';
  return 'bad';
}

// Lower ratio is healthier (recurring load).
function rateLowerIsBetter(value: number | null, goodUpTo: number, warnUpTo: number): HealthRating {
  if (value === null) return 'unknown';
  if (value <= goodUpTo) return 'good';
  if (value <= warnUpTo) return 'warn';
  return 'bad';
}

export function computeHealth({
  monthlyCashflow,
  liquidBalance,
  recurring,
  budgets,
  expensesByCategory,
  categoryById,
  rateFor,
}: HealthInput): HealthMetrics {
  // --- Savings rate (net / income) over months that actually had income ---
  const withIncome = monthlyCashflow.filter((m) => m.income > 0);
  const series: SavingsRatePoint[] = withIncome.map((m) => ({ month: m.month, rate: m.net / m.income }));
  const currentRate = series.length ? series[series.length - 1]!.rate : null;
  const averageRate = mean(series.map((p) => p.rate));

  // --- Emergency fund: liquid balance / average monthly expenses ---
  const avgMonthlyExpenses = mean(monthlyCashflow.filter((m) => m.expenses > 0).map((m) => m.expenses)) ?? 0;
  const monthsCovered = avgMonthlyExpenses > 0 ? liquidBalance / avgMonthlyExpenses : null;

  // --- Recurring load: monthly fixed commitments as a share of income ---
  const monthlyFixed = round2(
    recurring
      .filter((r) => r.active && r.type === 'expense')
      .reduce((sum, r) => sum + recurringMonthlyEquivalent(r) * rateFor(r.account_id), 0),
  );
  const avgMonthlyIncome = mean(withIncome.map((m) => m.income)) ?? 0;
  const recurringShare = avgMonthlyIncome > 0 ? monthlyFixed / avgMonthlyIncome : null;

  // --- Budget adherence for the current month ---
  const spentByCategory = new Map(expensesByCategory.map((c) => [c.category_id, c.amount]));
  const items: BudgetAdherenceItem[] = budgets.map((b) => {
    const spent = spentByCategory.get(b.category_id) ?? 0;
    return {
      categoryId: b.category_id,
      name: categoryById.get(b.category_id)?.name ?? 'Catégorie',
      spent: round2(spent),
      limit: b.amount_limit,
      ratio: b.amount_limit > 0 ? spent / b.amount_limit : 0,
      over: spent > b.amount_limit,
    };
  }).sort((a, b) => b.ratio - a.ratio);
  const budgetAdherence = budgets.length
    ? {
        budgetedTotal: round2(items.reduce((s, i) => s + i.limit, 0)),
        spentTotal: round2(items.reduce((s, i) => s + i.spent, 0)),
        overCount: items.filter((i) => i.over).length,
        withinCount: items.filter((i) => !i.over).length,
        items,
      }
    : null;

  return {
    savingsRate: {
      current: currentRate,
      average: averageRate,
      series,
      rating: rateHigherIsBetter(averageRate, 0.2, 0.05),
    },
    emergencyFund: {
      liquidBalance: round2(liquidBalance),
      avgMonthlyExpenses: round2(avgMonthlyExpenses),
      monthsCovered: monthsCovered === null ? null : round2(monthsCovered),
      rating: rateHigherIsBetter(monthsCovered, 6, 3),
    },
    recurringLoad: {
      monthlyFixed,
      avgMonthlyIncome: round2(avgMonthlyIncome),
      share: recurringShare,
      rating: rateLowerIsBetter(recurringShare, 0.5, 0.75),
    },
    fixedVsVariable: {
      fixed: monthlyFixed,
      variable: round2(Math.max(0, avgMonthlyExpenses - monthlyFixed)),
    },
    budgetAdherence,
  };
}
