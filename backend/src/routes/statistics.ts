import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { currencyQuery, dateString, idParam } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { buildFx } from '../lib/fxHelper.js';
import { addMonthsUtc, startOfUtcDay } from '../lib/dates.js';
import { categoryTypeLookup, LINE_SELECT, txFlows, type Flow } from '../lib/ledger.js';

export const statisticsRouter = Router();

const rangeSchema = z.enum(['3m', '6m', '1y', '2y', 'all', 'custom']).default('1y');
const optionalDate = dateString.optional();

// Flux (dépense / revenu) d'une opération, déjà convertis en devise de
// reporting. Une ligne de remboursement est une dépense négative sur la
// catégorie de la dépense d'origine (cf. lib/ledger.ts).
type ValuedFlow = Flow & { reported: number; refunded_description?: string | null };
type StatsTx = {
  date: Date;
  description: string | null;
  refunds_description: string | null;
  flows: ValuedFlow[];
};

// Long-range statistics: a unified endpoint that powers the "Statistiques"
// tab. Expense charts stay expense-only, while cashflow uses all income and
// expense flows over the same requested range. Virements, mouvements de
// bourse et ajustements n'ont pas de côté : ils sont exclus.
statisticsRouter.get('/users/:user_id/statistics', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const range = rangeSchema.parse(req.query.range ?? '1y');
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  const excludeUncategorized = String(req.query.exclude_uncategorized ?? 'true') === 'true';
  const fromParam = optionalDate.parse(req.query.from ?? undefined);
  const toParam = optionalDate.parse(req.query.to ?? undefined);
  // Filtre par tag : seulement les opérations qui le portent, ou tout sauf elles.
  const tagId = req.query.tag_id ? z.coerce.number().int().positive().parse(req.query.tag_id) : null;
  const tagMode = z.enum(['include', 'exclude']).parse(req.query.tag_mode ?? 'include');
  const tagFilter = tagId == null ? {} : tagMode === 'include' ? { tags: { some: { tag_id: tagId } } } : { tags: { none: { tag_id: tagId } } };

  const [rows, accounts, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: { user_id, kind: 'standard', ...tagFilter },
      // Projection minimale : seules les colonnes utilisées par les agrégations.
      select: {
        kind: true,
        date: true,
        description: true,
        lines: { select: LINE_SELECT },
        refunds_transaction_id: true,
      },
    }),
    prisma.account.findMany({ where: { user_id }, select: { id: true, currency: true } }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, name: true, color: true, type: true } }),
  ]);
  const { rates: fx } = await buildFx(accounts, reportCurrency);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryType = categoryTypeLookup(categories);

  // Montant d'un flux en devise de reporting : devise du compte de la ligne
  // (EUR quand la ligne n'a pas de compte).
  const rateOf = (accountId: number | null) => fx.get(accountById.get(accountId ?? -1)?.currency ?? 'EUR') ?? 1;
  // Libellé des dépenses remboursées (par ligne : un remboursement peut en couvrir plusieurs).
  const refundedIds = Array.from(new Set(rows.flatMap((t) => t.lines.map((l) => l.refund_of_id ?? (l.refund ? t.refunds_transaction_id : null)).filter((id): id is number => id != null))));
  const refundedDescription = new Map(
    (refundedIds.length > 0 ? await prisma.transaction.findMany({ where: { id: { in: refundedIds }, user_id }, select: { id: true, description: true } }) : [])
      .map((t) => [t.id, t.description]),
  );
  const transactions: StatsTx[] = rows.map((t) => ({
    date: t.date,
    description: t.description,
    refunds_description: null,
    flows: txFlows(t, categoryType).map((f) => ({
      ...f,
      reported: f.value * rateOf(f.account_id),
      refunded_description: f.refund ? refundedDescription.get(f.refund_of_id ?? t.refunds_transaction_id ?? -1) : undefined,
    })),
  }));
  const expenseFlows = (t: StatsTx) => t.flows.filter((f) => f.side === 'expense');
  // Expense charts intentionally ignore ordinary income: salary and similar
  // flows are not spending. Refund lines are kept and counted as negative
  // expense so they cancel the original category/merchant.
  const statsTransactions = transactions.filter((t) => expenseFlows(t).length > 0);

  const today = startOfUtcDay(new Date());
  const earliest = transactions.length > 0
    ? transactions.reduce((min, t) => (t.date < min ? t.date : min), transactions[0]!.date)
    : today;
  // Custom mode: any from/to wins. Otherwise the preset range computes from.
  let from = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : rangeStart(range, today, earliest);
  let to = toParam ? new Date(`${toParam}T00:00:00.000Z`) : today;
  if (from > to) [from, to] = [to, from];

  const inRange = statsTransactions.filter((t) => t.date >= from && t.date <= to);
  const cashflowInRange = transactions.filter((t) => t.date >= from && t.date <= to);
  const categoryEntries = inRange.flatMap((t) => expenseFlows(t).map((flow) => ({
    transaction: t,
    category_id: flow.category_id,
    amount: flow.reported,
  })));
  const consideredEntries = excludeUncategorized
    ? categoryEntries.filter((entry) => entry.category_id != null)
    : categoryEntries;
  const consideredTransactions = excludeUncategorized
    ? inRange.filter((t) => expenseFlows(t).some((flow) => flow.category_id != null))
    : inRange;

  const totalExpenses = categoryEntries.reduce((s, entry) => s + entry.amount, 0);
  const totalCategorized = categoryEntries
    .filter((entry) => entry.category_id != null)
    .reduce((s, entry) => s + entry.amount, 0);
  const totalUncategorized = totalExpenses - totalCategorized;

  // By category (une opération compte une fois par catégorie touchée)
  const byCategoryMap = new Map<number | null, { amount: number; txs: Set<StatsTx> }>();
  for (const categoryEntry of consideredEntries) {
    const categoryId = categoryEntry.category_id;
    const bucket = byCategoryMap.get(categoryId) ?? { amount: 0, txs: new Set<StatsTx>() };
    bucket.amount += categoryEntry.amount;
    bucket.txs.add(categoryEntry.transaction);
    byCategoryMap.set(categoryId, bucket);
  }
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category_id, { amount, txs }]) => {
      const category = category_id ? categoryById.get(category_id) : null;
      return {
        category_id,
        name: category?.name ?? 'Sans catégorie',
        color: category?.color ?? '#9ca3af',
        amount: round2(amount),
        transactions_count: txs.size,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // By merchant (deduped + normalized description). Les lignes de
  // remboursement s'imputent au marchand de la dépense remboursée.
  const merchantEntries = inRange.flatMap((t) => {
    const groups = new Map<string | null, { description: string | null; amount: number; categorized: boolean }>();
    for (const flow of expenseFlows(t)) {
      const description = flow.refunded_description !== undefined ? flow.refunded_description : t.description;
      const group = groups.get(description) ?? { description, amount: 0, categorized: false };
      group.amount += flow.reported;
      if (flow.category_id != null) group.categorized = true;
      groups.set(description, group);
    }
    return Array.from(groups.values());
  });
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
  for (const entry of categoryEntries) {
    const month = entry.transaction.date.toISOString().slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + entry.amount);
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
      monthly: buildCashflow(cashflowInRange, from, to),
      yearly: buildYearlyCashflow(cashflowInRange, from, to),
    },
  });
}));

// Revenus / dépenses (montants en devise de reporting) d'une opération.
function cashflowOf(t: StatsTx): { income: number; expenses: number } {
  let income = 0;
  let expenses = 0;
  for (const flow of t.flows) {
    if (flow.side === 'income') income += flow.reported;
    else expenses += flow.reported;
  }
  return { income, expenses };
}

function buildCashflow(transactions: StatsTx[], from: Date, to: Date) {
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
    const { income, expenses } = cashflowOf(transaction);
    bucket.income += income;
    bucket.expenses += expenses;
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

function buildYearlyCashflow(transactions: StatsTx[], from: Date, to: Date) {
  const buckets = new Map<string, { year: string; income: number; expenses: number; net: number }>();
  for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year += 1) {
    const key = String(year);
    buckets.set(key, { year: key, income: 0, expenses: 0, net: 0 });
  }

  for (const transaction of transactions) {
    const year = transaction.date.toISOString().slice(0, 4);
    const bucket = buckets.get(year);
    if (!bucket) continue;
    const { income, expenses } = cashflowOf(transaction);
    bucket.income += income;
    bucket.expenses += expenses;
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
