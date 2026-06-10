import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { currencyQuery, dateString, idParam } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { buildFx } from '../lib/fxHelper.js';

export const statisticsRouter = Router();

const rangeSchema = z.enum(['3m', '6m', '1y', '2y', 'all', 'custom']).default('1y');
const optionalDate = dateString.optional();

// Long-range expense statistics: a unified endpoint that powers the new
// "Statistiques" tab. Aggregates spending by category, by merchant
// (deduped description) and by month over the requested range.
statisticsRouter.get('/users/:user_id/statistics', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const range = rangeSchema.parse(req.query.range ?? '1y');
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  const excludeUncategorized = String(req.query.exclude_uncategorized ?? 'true') === 'true';
  const fromParam = optionalDate.parse(req.query.from ?? undefined);
  const toParam = optionalDate.parse(req.query.to ?? undefined);

  const [transactions, accounts, categories] = await Promise.all([
    // Statistics is intentionally expense-only: income flows aren't
    // categorised the same way (salary, etc.) and transfers between own
    // accounts aren't spending. Including them would skew every chart and
    // the "Top marchands" especially. Exception : les remboursements (revenus
    // liés à une dépense) comptent comme dépense négative — ils annulent la
    // dépense d'origine dans sa catégorie / chez son marchand.
    prisma.transaction.findMany({
      where: { user_id, OR: [{ type: 'expense' }, { type: 'income', refunds_transaction_id: { not: null } }] },
      include: { refunds_transaction: { select: { category_id: true, description: true } } },
    }),
    prisma.account.findMany({ where: { user_id } }),
    prisma.category.findMany({ where: { user_id } }),
  ]);
  const { rates: fx } = await buildFx(accounts, reportCurrency);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const today = startOfUtcDay(new Date());
  const earliest = transactions.length > 0
    ? transactions.reduce((min, t) => (t.date < min ? t.date : min), transactions[0]!.date)
    : today;
  // Custom mode: any from/to wins. Otherwise the preset range computes from.
  const from = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : rangeStart(range, today, earliest);
  const to = toParam ? new Date(`${toParam}T00:00:00.000Z`) : today;

  // Convert raw transaction amounts to the report currency via the source account's
  // currency. Transactions without an account default to EUR (which gets converted).
  // Dans ce dataset, un `income` est forcément un remboursement (cf. la requête) :
  // il compte négativement et s'impute sur la catégorie / le marchand de la
  // dépense qu'il rembourse.
  const txValue = (t: { type: string; amount: number; account_id: number | null }) => {
    const currency = accountById.get(t.account_id ?? -1)?.currency ?? 'EUR';
    const value = t.amount * (fx.get(currency) ?? 1);
    return t.type === 'income' ? -value : value;
  };
  type StatTx = (typeof transactions)[number];
  const effectiveCategoryId = (t: StatTx) => (t.type === 'income' ? t.refunds_transaction?.category_id ?? null : t.category_id);
  const effectiveDescription = (t: StatTx) => (t.type === 'income' ? t.refunds_transaction?.description ?? t.description : t.description);

  const inRange = transactions.filter((t) => t.date >= from && t.date <= to);
  const considered = excludeUncategorized
    ? inRange.filter((t) => effectiveCategoryId(t) != null)
    : inRange;

  const totalExpenses = inRange.reduce((s, t) => s + txValue(t), 0);
  const totalCategorized = inRange.filter((t) => effectiveCategoryId(t) != null).reduce((s, t) => s + txValue(t), 0);
  const totalUncategorized = totalExpenses - totalCategorized;

  // By category
  const byCategoryMap = new Map<number | null, { amount: number; count: number }>();
  for (const t of considered) {
    const categoryId = effectiveCategoryId(t);
    const entry = byCategoryMap.get(categoryId) ?? { amount: 0, count: 0 };
    entry.amount += txValue(t);
    entry.count += 1;
    byCategoryMap.set(categoryId, entry);
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
  const byMerchantMap = new Map<string, { display: string; amount: number; count: number }>();
  for (const t of considered) {
    const raw = (effectiveDescription(t) ?? '').trim();
    if (raw.length === 0) continue;
    const key = raw.toUpperCase().replace(/\s+/g, ' ');
    const entry = byMerchantMap.get(key) ?? { display: raw, amount: 0, count: 0 };
    entry.amount += txValue(t);
    entry.count += 1;
    byMerchantMap.set(key, entry);
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
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + txValue(t));
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
    transactions_count: considered.length,
    by_category: byCategory,
    by_merchant: byMerchant,
    monthly,
  });
}));

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function rangeStart(range: z.infer<typeof rangeSchema>, today: Date, earliest: Date): Date {
  switch (range) {
    case '3m': return addMonths(today, -3);
    case '6m': return addMonths(today, -6);
    case '1y': return addMonths(today, -12);
    case '2y': return addMonths(today, -24);
    case 'all': return startOfUtcDay(earliest);
    case 'custom': return addMonths(today, -12);
  }
}
