import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { currencyQuery, idParam, monthString } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { fetchExchangeRate, normalizeCurrency } from '../lib/fx.js';

export const dashboardRouter = Router();

type Tx = { type: string; amount: number; to_amount: number | null; date: Date; category_id: number | null; account_id: number | null; to_account_id: number | null };
type AccountRow = { id: number; name: string; type: string; currency: string; initial_balance: number; initial_balance_date: Date };

// Effet d'une transaction sur le compte dont elle est la source (account_id).
// Un transfert débite le compte source ; le crédit du compte destination est
// ajouté séparément dans computeBalance.
function sourceDelta(t: { type: string; amount: number }): number {
  return t.type === 'income' ? t.amount : -t.amount;
}

dashboardRouter.get('/users/:user_id/dashboard', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

  const [transactions, accounts, categories, snapshots] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id } }),
    prisma.account.findMany({ where: { user_id } }),
    prisma.category.findMany({ where: { user_id } }),
    prisma.accountSnapshot.findMany({ where: { user_id } }),
  ]);
  const fx = await buildFx(accounts, reportCurrency);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const txValue = (t: Tx) => round2(t.amount * (fx.get(accountById.get(t.account_id ?? -1)?.currency ?? 'EUR') ?? 1));

  const monthTransactions = transactions.filter((t) => t.date >= start && t.date < end);
  const income = monthTransactions.filter((t) => t.type === 'income').reduce((s, t) => s + txValue(t), 0);
  const expenses = monthTransactions.filter((t) => t.type === 'expense').reduce((s, t) => s + txValue(t), 0);

  const accountBalances = computeAccountBalances(accounts, transactions, snapshots, fx);
  const unassignedBalance = computeUnassignedBalance(transactions);
  const assets = accountBalances.filter((a) => !a.is_liability).reduce((s, a) => s + a.balance, 0) + unassignedBalance;
  const liabilities = accountBalances.filter((a) => a.is_liability).reduce((s, a) => s + a.balance, 0);
  const netWorth = assets - liabilities;
  const balanceByGroup = buildBalanceByGroup(accountBalances, unassignedBalance);

  const byCategory = new Map<number | null, number>();
  for (const t of monthTransactions.filter((t) => t.type === 'expense')) {
    byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + txValue(t));
  }
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  res.json({
    month,
    currency: reportCurrency,
    exchange_rates: Object.fromEntries(fx.entries()),
    income: round2(income),
    expenses: round2(expenses),
    net: round2(income - expenses),
    balance: round2(netWorth),
    balance_assets: round2(assets),
    balance_liabilities: round2(liabilities),
    net_worth: round2(netWorth),
    account_balances: accountBalances.map((a) => ({ ...a, balance: round2(a.balance), signed_balance: round2(a.signed_balance) })),
    balance_by_group: balanceByGroup,
    monthly_cashflow: buildCashflow(transactions, start, accountById, fx),
    yearly_cashflow: buildYearlyCashflow(transactions, accountById, fx),
    expenses_by_category: Array.from(byCategory.entries()).map(([category_id, amount]) => {
      const category = category_id ? categoryById.get(category_id) : null;
      return { category_id, name: category?.name ?? 'Sans catégorie', color: category?.color ?? '#9ca3af', amount: round2(amount) };
    }),
  });
}));

dashboardRouter.get('/users/:user_id/wealth-history', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const range = String(req.query.range ?? '12m');
  const granularity = String(req.query.granularity ?? 'month');
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');

  const [transactions, accounts, snapshots] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id } }),
    prisma.account.findMany({ where: { user_id } }),
    prisma.accountSnapshot.findMany({ where: { user_id } }),
  ]);
  const fx = await buildFx(accounts, reportCurrency);

  const today = startOfUtcDay(new Date());
  const firstDate = firstRelevantDate(accounts, transactions, snapshots) ?? today;
  const from = rangeStart(range, today, firstDate);
  const dates = buildHistoryDates(from, today, granularity);

  const points = dates.map((date) => {
    const accountBalances = computeAccountBalancesAt(accounts, transactions, snapshots, date, fx);
    const unassignedBalance = computeUnassignedBalanceUntil(transactions, date);
    const assets = accountBalances.filter((a) => !a.is_liability).reduce((s, a) => s + a.balance, 0) + unassignedBalance;
    const liabilities = accountBalances.filter((a) => a.is_liability).reduce((s, a) => s + a.balance, 0);
    const byGroup = buildBalanceByGroup(accountBalances, unassignedBalance).reduce<Record<string, number>>((acc, row) => {
      acc[row.group] = row.signed_amount;
      return acc;
    }, {});
    return {
      date: dateKey(date),
      currency: reportCurrency,
      assets: round2(assets),
      liabilities: round2(liabilities),
      net_worth: round2(assets - liabilities),
      by_group: byGroup,
    };
  });

  res.json(points);
}));

// Solde estimé : pour chaque compte on part du snapshot de solde le plus récent
// (ou du solde initial s'il n'y a pas de snapshot) puis on applique les transactions
// postérieures à cette date. Les transactions sans compte sont ajoutées à plat.
function computeAccountBalances(
  accounts: AccountRow[],
  transactions: Tx[],
  snapshots: Array<{ account_id: number; date: Date; balance: number }>,
  fx: Map<string, number>,
): Array<{
  account_id: number;
  name: string;
  type: string;
  currency: string;
  type_label: string;
  group: string;
  group_label: string;
  balance: number;
  signed_balance: number;
  is_liability: boolean;
}> {
  const latestSnapshot = new Map<number, { date: Date; balance: number }>();
  for (const s of snapshots) {
    const current = latestSnapshot.get(s.account_id);
    if (!current || s.date > current.date) latestSnapshot.set(s.account_id, { date: s.date, balance: s.balance });
  }

  return accounts.map((account) => {
    const snap = latestSnapshot.get(account.id);
    const base = snap ? snap.balance : account.initial_balance;
    const since = snap ? snap.date : account.initial_balance_date;
    const outgoing = transactions
      .filter((t) => t.account_id === account.id && t.date > since)
      .reduce((s, t) => s + sourceDelta(t), 0);
    const incoming = transactions
      .filter((t) => t.type === 'transfer' && t.to_account_id === account.id && t.date > since)
      .reduce((s, t) => s + (t.to_amount ?? t.amount), 0);
    const rawBalance = (base + outgoing + incoming) * (fx.get(account.currency) ?? 1);
    const isLiability = isLiabilityAccount(account.type);
    const balance = isLiability ? Math.abs(rawBalance) : rawBalance;
    return {
      account_id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      type_label: accountTypeLabel(account.type),
      group: accountTypeGroup(account.type),
      group_label: accountGroupLabel(accountTypeGroup(account.type)),
      balance,
      signed_balance: isLiability ? -balance : balance,
      is_liability: isLiability,
    };
  });
}

function computeAccountBalancesAt(
  accounts: AccountRow[],
  transactions: Tx[],
  snapshots: Array<{ account_id: number; date: Date; balance: number }>,
  at: Date,
  fx: Map<string, number>,
) {
  const snapshotsUntil = snapshots.filter((s) => s.date <= at);
  const transactionsUntil = transactions.filter((t) => t.date <= at);
  return computeAccountBalances(accounts.filter((a) => a.initial_balance_date <= at), transactionsUntil, snapshotsUntil, fx);
}

function computeUnassignedBalance(transactions: Tx[]): number {
  // Transactions sans compte : seuls revenus/dépenses comptent (un transfert sans compte n'a pas de sens).
  return transactions
    .filter((t) => t.account_id == null && t.type !== 'transfer')
    .reduce((s, t) => s + sourceDelta(t), 0);
}

function computeUnassignedBalanceUntil(transactions: Tx[], at: Date): number {
  return computeUnassignedBalance(transactions.filter((t) => t.date <= at));
}

function buildBalanceByGroup(
  accountBalances: Array<{ group: string; group_label: string; signed_balance: number; balance: number; is_liability: boolean }>,
  unassignedBalance: number,
) {
  const groups = new Map<string, { group: string; label: string; amount: number; signed_amount: number; is_liability: boolean }>();
  for (const account of accountBalances) {
    const row = groups.get(account.group) ?? {
      group: account.group,
      label: account.group_label,
      amount: 0,
      signed_amount: 0,
      is_liability: account.is_liability,
    };
    row.amount += account.balance;
    row.signed_amount += account.signed_balance;
    row.is_liability = row.is_liability || account.is_liability;
    groups.set(account.group, row);
  }
  if (unassignedBalance !== 0) {
    const row = groups.get('cash') ?? { group: 'cash', label: accountGroupLabel('cash'), amount: 0, signed_amount: 0, is_liability: false };
    row.amount += unassignedBalance;
    row.signed_amount += unassignedBalance;
    groups.set('cash', row);
  }
  return Array.from(groups.values())
    .map((row) => ({ ...row, amount: round2(row.amount), signed_amount: round2(row.signed_amount) }))
    .sort((a, b) => Math.abs(b.signed_amount) - Math.abs(a.signed_amount));
}

function isLiabilityAccount(type: string): boolean {
  return type === 'credit' || type === 'loan';
}

function accountTypeGroup(type: string): string {
  if (['checking', 'cash'].includes(type)) return 'cash';
  if (['savings', 'livret_a', 'ldds', 'lep', 'pel', 'cel'].includes(type)) return 'regulated_savings';
  if (['pea', 'securities', 'life_insurance', 'retirement'].includes(type)) return 'investments';
  if (type === 'crypto') return 'crypto';
  if (['credit', 'loan'].includes(type)) return 'liabilities';
  return 'other';
}

function accountGroupLabel(group: string): string {
  const labels: Record<string, string> = {
    cash: 'Liquidités',
    regulated_savings: 'Livrets',
    investments: 'Investissements',
    crypto: 'Crypto',
    liabilities: 'Passifs',
    other: 'Autres',
  };
  return labels[group] ?? group;
}

function accountTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    checking: 'Compte courant',
    savings: 'Épargne',
    livret_a: 'Livret A',
    ldds: 'LDDS',
    lep: 'LEP',
    pel: 'PEL',
    cel: 'CEL',
    pea: 'PEA',
    securities: 'Compte-titres',
    life_insurance: 'Assurance-vie',
    crypto: 'Crypto',
    retirement: 'Retraite',
    cash: 'Espèces',
    credit: 'Carte / crédit',
    loan: 'Emprunt',
    other: 'Autre',
  };
  return labels[type] ?? type;
}

function firstRelevantDate(
  accounts: AccountRow[],
  transactions: Tx[],
  snapshots: Array<{ date: Date }>,
): Date | null {
  const dates = [
    ...accounts.map((a) => a.initial_balance_date),
    ...transactions.map((t) => t.date),
    ...snapshots.map((s) => s.date),
  ].sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}

function rangeStart(range: string, today: Date, firstDate: Date): Date {
  if (range === '1m') return addMonths(today, -1);
  if (range === '6m') return addMonths(today, -6);
  if (range === 'ytd') return new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  if (range === 'all') return firstDate;
  return addMonths(today, -12);
}

function buildHistoryDates(from: Date, to: Date, granularity: string): Date[] {
  const dates: Date[] = [];
  const cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    if (granularity === 'day') {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } else if (granularity === 'week') {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    } else {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    }
  }
  if (dates.length === 0 || dateKey(dates[dates.length - 1]!) !== dateKey(end)) dates.push(end);
  return dates;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

function addMonths(date: Date, months: number): Date {
  const out = startOfUtcDay(date);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

function buildCashflow(transactions: Tx[], endMonth: Date, accountById: Map<number, AccountRow>, fx: Map<string, number>) {
  const buckets = new Map<string, { month: string; income: number; expenses: number; net: number }>();
  for (let i = 11; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - i, 1));
    const key = start.toISOString().slice(0, 7);
    buckets.set(key, { month: key, income: 0, expenses: 0, net: 0 });
  }
  for (const t of transactions) {
    const bucket = buckets.get(t.date.toISOString().slice(0, 7));
    if (!bucket) continue;
    const value = t.amount * (fx.get(accountById.get(t.account_id ?? -1)?.currency ?? 'EUR') ?? 1);
    if (t.type === 'income') bucket.income += value;
    if (t.type === 'expense') bucket.expenses += value;
    bucket.net = bucket.income - bucket.expenses;
  }
  return Array.from(buckets.values()).map((b) => ({
    month: b.month,
    income: round2(b.income),
    expenses: round2(b.expenses),
    net: round2(b.net),
  }));
}

function buildYearlyCashflow(transactions: Tx[], accountById: Map<number, AccountRow>, fx: Map<string, number>) {
  const byYear = new Map<string, { year: string; income: number; expenses: number; net: number }>();
  for (const transaction of transactions) {
    const year = transaction.date.toISOString().slice(0, 4);
    const row = byYear.get(year) ?? { year, income: 0, expenses: 0, net: 0 };
    const value = transaction.amount * (fx.get(accountById.get(transaction.account_id ?? -1)?.currency ?? 'EUR') ?? 1);
    if (transaction.type === 'income') row.income += value;
    if (transaction.type === 'expense') row.expenses += value;
    row.net = row.income - row.expenses;
    byYear.set(year, row);
  }
  return Array.from(byYear.values())
    .map((r) => ({ year: r.year, income: round2(r.income), expenses: round2(r.expenses), net: round2(r.net) }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

async function buildFx(accounts: AccountRow[], reportCurrency: string): Promise<Map<string, number>> {
  const currencies = Array.from(new Set(['EUR', reportCurrency, ...accounts.map((account) => normalizeCurrency(account.currency))]));
  const entries = await Promise.all(currencies.map(async (currency) => {
    if (currency === reportCurrency) return [currency, 1] as const;
    const quote = await fetchExchangeRate(currency, reportCurrency);
    return [currency, quote.rate] as const;
  }));
  return new Map(entries);
}
