import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { idParam, monthString } from '../lib/validation.js';
import { round2 } from '../lib/money.js';

export const dashboardRouter = Router();

type Tx = { type: string; amount: number; date: Date; category_id: number | null; account_id: number | null; to_account_id: number | null };

// Effet d'une transaction sur le compte dont elle est la source (account_id).
// Un transfert débite le compte source ; le crédit du compte destination est
// ajouté séparément dans computeBalance.
function sourceDelta(t: { type: string; amount: number }): number {
  return t.type === 'income' ? t.amount : -t.amount;
}

dashboardRouter.get('/users/:user_id/dashboard', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

  const [transactions, accounts, categories, snapshots] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id } }),
    prisma.account.findMany({ where: { user_id } }),
    prisma.category.findMany({ where: { user_id } }),
    prisma.accountSnapshot.findMany({ where: { user_id } }),
  ]);

  const monthTransactions = transactions.filter((t) => t.date >= start && t.date < end);
  const income = monthTransactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = monthTransactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const balance = computeBalance(accounts, transactions, snapshots);

  const byCategory = new Map<number | null, number>();
  for (const t of monthTransactions.filter((t) => t.type === 'expense')) {
    byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + t.amount);
  }
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  res.json({
    month,
    income: round2(income),
    expenses: round2(expenses),
    net: round2(income - expenses),
    balance: round2(balance),
    monthly_cashflow: buildCashflow(transactions, start),
    yearly_cashflow: buildYearlyCashflow(transactions),
    expenses_by_category: Array.from(byCategory.entries()).map(([category_id, amount]) => {
      const category = category_id ? categoryById.get(category_id) : null;
      return { category_id, name: category?.name ?? 'Sans catégorie', color: category?.color ?? '#9ca3af', amount: round2(amount) };
    }),
  });
}));

// Solde estimé : pour chaque compte on part du snapshot de solde le plus récent
// (ou du solde initial s'il n'y a pas de snapshot) puis on applique les transactions
// postérieures à cette date. Les transactions sans compte sont ajoutées à plat.
function computeBalance(
  accounts: Array<{ id: number; initial_balance: number; initial_balance_date: Date }>,
  transactions: Tx[],
  snapshots: Array<{ account_id: number; date: Date; balance: number }>,
): number {
  const latestSnapshot = new Map<number, { date: Date; balance: number }>();
  for (const s of snapshots) {
    const current = latestSnapshot.get(s.account_id);
    if (!current || s.date > current.date) latestSnapshot.set(s.account_id, { date: s.date, balance: s.balance });
  }

  let balance = 0;
  for (const account of accounts) {
    const snap = latestSnapshot.get(account.id);
    const base = snap ? snap.balance : account.initial_balance;
    const since = snap ? snap.date : account.initial_balance_date;
    const outgoing = transactions
      .filter((t) => t.account_id === account.id && t.date > since)
      .reduce((s, t) => s + sourceDelta(t), 0);
    const incoming = transactions
      .filter((t) => t.type === 'transfer' && t.to_account_id === account.id && t.date > since)
      .reduce((s, t) => s + t.amount, 0);
    balance += base + outgoing + incoming;
  }

  // Transactions sans compte : seuls revenus/dépenses comptent (un transfert sans compte n'a pas de sens).
  balance += transactions
    .filter((t) => t.account_id == null && t.type !== 'transfer')
    .reduce((s, t) => s + sourceDelta(t), 0);

  return balance;
}

function buildCashflow(transactions: Tx[], endMonth: Date) {
  const buckets = new Map<string, { month: string; income: number; expenses: number; net: number }>();
  for (let i = 11; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - i, 1));
    const key = start.toISOString().slice(0, 7);
    buckets.set(key, { month: key, income: 0, expenses: 0, net: 0 });
  }
  for (const t of transactions) {
    const bucket = buckets.get(t.date.toISOString().slice(0, 7));
    if (!bucket) continue;
    if (t.type === 'income') bucket.income += t.amount;
    if (t.type === 'expense') bucket.expenses += t.amount;
    bucket.net = bucket.income - bucket.expenses;
  }
  return Array.from(buckets.values()).map((b) => ({
    month: b.month,
    income: round2(b.income),
    expenses: round2(b.expenses),
    net: round2(b.net),
  }));
}

function buildYearlyCashflow(transactions: Tx[]) {
  const byYear = new Map<string, { year: string; income: number; expenses: number; net: number }>();
  for (const transaction of transactions) {
    const year = transaction.date.toISOString().slice(0, 4);
    const row = byYear.get(year) ?? { year, income: 0, expenses: 0, net: 0 };
    if (transaction.type === 'income') row.income += transaction.amount;
    if (transaction.type === 'expense') row.expenses += transaction.amount;
    row.net = row.income - row.expenses;
    byYear.set(year, row);
  }
  return Array.from(byYear.values())
    .map((r) => ({ year: r.year, income: round2(r.income), expenses: round2(r.expenses), net: round2(r.net) }))
    .sort((a, b) => a.year.localeCompare(b.year));
}
