import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { currencyQuery, dateString, idParam } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { buildFx } from '../lib/fxHelper.js';
import { addMonthsUtc, startOfUtcDay } from '../lib/dates.js';

export const statisticsRouter = Router();

const rangeSchema = z.enum(['3m', '6m', '1y', '2y', 'all', 'custom']).default('1y');
const optionalDate = dateString.optional();
type CashflowTx = {
  type: string;
  amount: number;
  date: Date;
  account_id: number | null;
  refunds_transaction: unknown | null;
  refund_allocations_sent: Array<{ amount: number }>;
};
type CashflowAccount = { currency: string };

// Long-range statistics: a unified endpoint that powers the "Statistiques"
// tab. Expense charts stay expense-only, while cashflow uses all income and
// expense transactions over the same requested range.
statisticsRouter.get('/users/:user_id/statistics', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const range = rangeSchema.parse(req.query.range ?? '1y');
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  const excludeUncategorized = String(req.query.exclude_uncategorized ?? 'true') === 'true';
  const fromParam = optionalDate.parse(req.query.from ?? undefined);
  const toParam = optionalDate.parse(req.query.to ?? undefined);

  const [transactions, accounts, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        user_id,
        type: { in: ['expense', 'income'] },
      },
      // Projection minimale : seules les colonnes utilisées par les agrégations.
      select: {
        type: true,
        amount: true,
        date: true,
        account_id: true,
        category_id: true,
        description: true,
        splits: { select: { category_id: true, amount: true } },
        refunds_transaction: {
          select: {
            amount: true,
            category_id: true,
            description: true,
            splits: { select: { category_id: true, amount: true } },
          },
        },
        refund_allocations_sent: {
          select: {
            amount: true,
            expense_transaction: {
              select: {
                amount: true,
                category_id: true,
                description: true,
                splits: { select: { category_id: true, amount: true } },
              },
            },
          },
        },
      },
    }),
    prisma.account.findMany({ where: { user_id }, select: { id: true, currency: true } }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, name: true, color: true } }),
  ]);
  const { rates: fx } = await buildFx(accounts, reportCurrency);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  // Expense charts intentionally ignore ordinary income: salary and similar
  // flows are not spending. Refund incomes are kept and counted as negative
  // expense so they cancel the original category/merchant.
  const statsTransactions = transactions.filter((t) => t.type === 'expense' || isStatsRefund(t));

  const today = startOfUtcDay(new Date());
  const earliest = transactions.length > 0
    ? transactions.reduce((min, t) => (t.date < min ? t.date : min), transactions[0]!.date)
    : today;
  // Custom mode: any from/to wins. Otherwise the preset range computes from.
  let from = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : rangeStart(range, today, earliest);
  let to = toParam ? new Date(`${toParam}T00:00:00.000Z`) : today;
  if (from > to) [from, to] = [to, from];

  // Convert raw transaction amounts to the report currency via the source account's
  // currency. Transactions without an account default to EUR (which gets converted).
  // Dans les agrégats de dépenses ci-dessous, un `income` a déjà été filtré
  // comme remboursement : il compte négativement et s'impute sur la catégorie /
  // le marchand de la dépense qu'il rembourse.
  const txValue = (t: { type: string; amount: number; account_id: number | null }, amount = t.amount) => {
    const currency = accountById.get(t.account_id ?? -1)?.currency ?? 'EUR';
    const value = amount * (fx.get(currency) ?? 1);
    return t.type === 'income' ? -value : value;
  };
  const inRange = statsTransactions.filter((t) => t.date >= from && t.date <= to);
  const cashflowInRange = transactions.filter((t) => t.date >= from && t.date <= to);
  const categoryEntries = inRange.flatMap((t) => categoryAllocationsForStats(t).map((allocation) => ({
    transaction: t,
    category_id: allocation.category_id,
    amount: txValue(t, allocation.amount),
  })));
  const consideredEntries = excludeUncategorized
    ? categoryEntries.filter((entry) => entry.category_id != null)
    : categoryEntries;
  const consideredTransactions = excludeUncategorized
    ? inRange.filter((t) => categoryAllocationsForStats(t).some((allocation) => allocation.category_id != null))
    : inRange;

  const totalExpenses = inRange.reduce((s, t) => {
    if (t.type === 'expense') return s + txValue(t);
    return s + txValue(t, refundAllocatedAmountForStats(t));
  }, 0);
  const totalCategorized = categoryEntries
    .filter((entry) => entry.category_id != null)
    .reduce((s, entry) => s + entry.amount, 0);
  const totalUncategorized = totalExpenses - totalCategorized;

  // By category
  const byCategoryMap = new Map<number | null, { amount: number; count: number }>();
  for (const categoryEntry of consideredEntries) {
    const categoryId = categoryEntry.category_id;
    const bucket = byCategoryMap.get(categoryId) ?? { amount: 0, count: 0 };
    bucket.amount += categoryEntry.amount;
    bucket.count += 1;
    byCategoryMap.set(categoryId, bucket);
  }
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category_id, { amount, count }]) => {
      const category = category_id ? categoryById.get(category_id) : null;
      return {
        category_id,
        name: category?.name ?? 'Sans catégorie',
        color: category?.color ?? '#9ca3af',
        amount: round2(amount),
        transactions_count: count,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // By merchant (deduped + normalized description)
  const merchantEntries = inRange.flatMap((t) => merchantAllocationsForStats(t).map((entry) => ({
    ...entry,
    amount: txValue(t, entry.amount),
  })));
  const consideredMerchantEntries = excludeUncategorized
    ? merchantEntries.filter((entry) => entry.categorized)
    : merchantEntries;
  const byMerchantMap = new Map<string, { display: string; amount: number; count: number }>();
  for (const merchantEntry of consideredMerchantEntries) {
    const raw = (merchantEntry.description ?? '').trim();
    if (raw.length === 0) continue;
    const key = raw.toUpperCase().replace(/\s+/g, ' ');
    const bucket = byMerchantMap.get(key) ?? { display: raw, amount: 0, count: 0 };
    bucket.amount += merchantEntry.amount;
    bucket.count += 1;
    byMerchantMap.set(key, bucket);
  }
  const byMerchant = Array.from(byMerchantMap.values())
    .map((row) => ({ description: row.display, amount: round2(row.amount), transactions_count: row.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 30);

  // Monthly evolution — pre-seed every month in the [from, today] range with
  // 0 so months without any expense still appear on the chart (otherwise
  // recharts would jump straight from one populated month to the next,
  // hiding the gap).
  const monthlyMap = new Map<string, number>();
  const monthCursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (monthCursor <= lastMonth) {
    monthlyMap.set(monthCursor.toISOString().slice(0, 7), 0);
    monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  }
  for (const t of inRange) {
    const month = t.date.toISOString().slice(0, 7);
    const value = t.type === 'expense'
      ? txValue(t)
      : txValue(t, refundAllocatedAmountForStats(t));
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + value);
  }
  const monthly = Array.from(monthlyMap.entries())
    .map(([month, amount]) => ({ month, amount: round2(amount) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  res.json({
    range,
    currency: reportCurrency,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    exclude_uncategorized: excludeUncategorized,
    total_expenses: round2(totalExpenses),
    total_categorized: round2(totalCategorized),
    total_uncategorized: round2(totalUncategorized),
    transactions_count: consideredTransactions.length,
    by_category: byCategory,
    by_merchant: byMerchant,
    monthly,
    cashflow: {
      monthly: buildCashflow(cashflowInRange, from, to, accountById, fx),
      yearly: buildYearlyCashflow(cashflowInRange, from, to, accountById, fx),
    },
  });
}));

function isStatsRefund(t: {
  type: string;
  refunds_transaction: unknown | null;
  refund_allocations_sent: Array<unknown>;
}): boolean {
  return t.type === 'income' && (t.refunds_transaction != null || t.refund_allocations_sent.length > 0);
}

function baseCategoryAllocations(t: {
  amount: number;
  category_id: number | null;
  splits: Array<{ category_id: number; amount: number }>;
}): Array<{ category_id: number | null; amount: number }> {
  return t.splits.length > 0
    ? t.splits.map((split) => ({ category_id: split.category_id, amount: split.amount }))
    : [{ category_id: t.category_id, amount: t.amount }];
}

function categoryAllocationsForStats(t: {
  type: string;
  amount: number;
  category_id: number | null;
  splits: Array<{ category_id: number; amount: number }>;
  refunds_transaction: {
    amount: number;
    category_id: number | null;
    splits: Array<{ category_id: number; amount: number }>;
  } | null;
  refund_allocations_sent: Array<{
    amount: number;
    expense_transaction: {
      amount: number;
      category_id: number | null;
      splits: Array<{ category_id: number; amount: number }>;
    };
  }>;
}): Array<{ category_id: number | null; amount: number }> {
  if (t.type !== 'income') return baseCategoryAllocations(t);
  if (t.refund_allocations_sent.length > 0) {
    return t.refund_allocations_sent.flatMap((refundAllocation) => {
      const target = refundAllocation.expense_transaction;
      if (!target || target.amount <= 0) return [{ category_id: null, amount: refundAllocation.amount }];
      return baseCategoryAllocations(target).map((allocation) => ({
        category_id: allocation.category_id,
        amount: refundAllocation.amount * (allocation.amount / target.amount),
      }));
    });
  }
  const target = t.refunds_transaction;
  if (!target || target.amount <= 0) return [{ category_id: null, amount: t.amount }];
  return baseCategoryAllocations(target).map((allocation) => ({
    category_id: allocation.category_id,
    amount: t.amount * (allocation.amount / target.amount),
  }));
}

function refundAllocatedAmountForStats(t: {
  amount: number;
  refunds_transaction: unknown | null;
  refund_allocations_sent: Array<{ amount: number }>;
}): number {
  if (t.refund_allocations_sent.length > 0) {
    return Math.min(t.amount, t.refund_allocations_sent.reduce((sum, allocation) => sum + allocation.amount, 0));
  }
  return t.refunds_transaction != null ? t.amount : 0;
}

function hasCategorizedAllocation(t: {
  amount: number;
  category_id: number | null;
  splits: Array<{ category_id: number; amount: number }>;
}): boolean {
  return baseCategoryAllocations(t).some((allocation) => allocation.category_id != null);
}

function merchantAllocationsForStats(t: {
  type: string;
  amount: number;
  description: string | null;
  category_id: number | null;
  splits: Array<{ category_id: number; amount: number }>;
  refunds_transaction: {
    amount: number;
    category_id: number | null;
    description: string | null;
    splits: Array<{ category_id: number; amount: number }>;
  } | null;
  refund_allocations_sent: Array<{
    amount: number;
    expense_transaction: {
      amount: number;
      category_id: number | null;
      description: string | null;
      splits: Array<{ category_id: number; amount: number }>;
    };
  }>;
}): Array<{ description: string | null; amount: number; categorized: boolean }> {
  if (t.type !== 'income') {
    return [{ description: t.description, amount: t.amount, categorized: hasCategorizedAllocation(t) }];
  }
  if (t.refund_allocations_sent.length > 0) {
    return t.refund_allocations_sent.map((refundAllocation) => ({
      description: refundAllocation.expense_transaction?.description ?? t.description,
      amount: refundAllocation.amount,
      categorized: refundAllocation.expense_transaction
        ? hasCategorizedAllocation(refundAllocation.expense_transaction)
        : false,
    }));
  }
  const target = t.refunds_transaction;
  return [{
    description: target?.description ?? t.description,
    amount: t.amount,
    categorized: target ? hasCategorizedAllocation(target) : false,
  }];
}

function buildCashflow(
  transactions: CashflowTx[],
  from: Date,
  to: Date,
  accountById: Map<number, CashflowAccount>,
  fx: Map<string, number>,
) {
  const buckets = new Map<string, { month: string; income: number; expenses: number; net: number }>();
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= lastMonth) {
    const key = cursor.toISOString().slice(0, 7);
    buckets.set(key, { month: key, income: 0, expenses: 0, net: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  for (const transaction of transactions) {
    const bucket = buckets.get(transaction.date.toISOString().slice(0, 7));
    if (!bucket) continue;
    const rate = fx.get(accountById.get(transaction.account_id ?? -1)?.currency ?? 'EUR') ?? 1;
    if (transaction.type === 'income') {
      const refundAmount = refundAllocatedAmountForStats(transaction);
      if (refundAmount > 0) bucket.expenses -= refundAmount * rate;
      if (transaction.amount > refundAmount) bucket.income += (transaction.amount - refundAmount) * rate;
    }
    if (transaction.type === 'expense') bucket.expenses += transaction.amount * rate;
    bucket.net = bucket.income - bucket.expenses;
  }

  let cumulativeNet = 0;
  return Array.from(buckets.values()).map((bucket) => {
    cumulativeNet += bucket.net;
    return {
      month: bucket.month,
      income: round2(bucket.income),
      expenses: round2(bucket.expenses),
      expenses_signed: round2(-bucket.expenses),
      net: round2(bucket.net),
      cumulative_net: round2(cumulativeNet),
    };
  });
}

function buildYearlyCashflow(
  transactions: CashflowTx[],
  from: Date,
  to: Date,
  accountById: Map<number, CashflowAccount>,
  fx: Map<string, number>,
) {
  const buckets = new Map<string, { year: string; income: number; expenses: number; net: number }>();
  for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year += 1) {
    const key = String(year);
    buckets.set(key, { year: key, income: 0, expenses: 0, net: 0 });
  }

  for (const transaction of transactions) {
    const year = transaction.date.toISOString().slice(0, 4);
    const bucket = buckets.get(year);
    if (!bucket) continue;
    const rate = fx.get(accountById.get(transaction.account_id ?? -1)?.currency ?? 'EUR') ?? 1;
    if (transaction.type === 'income') {
      const refundAmount = refundAllocatedAmountForStats(transaction);
      if (refundAmount > 0) bucket.expenses -= refundAmount * rate;
      if (transaction.amount > refundAmount) bucket.income += (transaction.amount - refundAmount) * rate;
    }
    if (transaction.type === 'expense') bucket.expenses += transaction.amount * rate;
    bucket.net = bucket.income - bucket.expenses;
  }

  return Array.from(buckets.values()).map((bucket) => ({
    year: bucket.year,
    income: round2(bucket.income),
    expenses: round2(bucket.expenses),
    net: round2(bucket.net),
  }));
}

function rangeStart(range: z.infer<typeof rangeSchema>, today: Date, earliest: Date): Date {
  switch (range) {
    case '3m': return addMonthsUtc(today, -3);
    case '6m': return addMonthsUtc(today, -6);
    case '1y': return addMonthsUtc(today, -12);
    case '2y': return addMonthsUtc(today, -24);
    case 'all': return startOfUtcDay(earliest);
    case 'custom': return addMonthsUtc(today, -12);
  }
}
