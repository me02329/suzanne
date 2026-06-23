import { Router } from 'express';
import { accountGroupLabel, accountTypeGroup, accountTypeLabel, type AccountType } from '@suzanne/shared';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { currencyQuery, idParam, monthString } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { buildFx } from '../lib/fxHelper.js';
import { buildFxByDate } from '../lib/fxStore.js';
import { securitiesByAccountByDate, securitiesByAccountNow } from '../lib/holdingsValuation.js';
import { categoryAllocations, isRefund, refundAllocatedAmount, refundCategoryAllocations } from '../lib/categorySpend.js';
import { addMonthsUtc, dateKey, startOfUtcDay } from '../lib/dates.js';

export const dashboardRouter = Router();

// Champs suffisants pour les calculs de soldes (wealth-history) ; le dashboard
// mensuel y ajoute les relations splits/remboursements pour ses agrégats.
type BalanceTx = {
  id: number;
  type: string;
  amount: number;
  to_amount: number | null;
  date: Date;
  category_id: number | null;
  account_id: number | null;
  to_account_id: number | null;
  refunds_transaction_id: number | null;
};
type Tx = BalanceTx & {
  splits: Array<{ category_id: number; amount: number }>;
  refund_allocations_sent: Array<{
    amount: number;
    expense_transaction: {
      amount: number;
      category_id: number | null;
      splits: Array<{ category_id: number; amount: number }>;
    };
  }>;
};
type AccountRow = { id: number; name: string; type: string; currency: string; initial_balance: number; initial_balance_date: Date };

// Projections minimales : ces endpoints chargent l'historique complet de
// l'utilisateur à chaque appel — on ne matérialise que les colonnes utilisées
// par les agrégations (les descriptions représentent l'essentiel du poids).
// wealth-history n'a PAS besoin des splits/remboursements : les soldes ne
// dépendent que des montants — on lui épargne ces jointures.
const BALANCE_TX_SELECT = {
  id: true,
  type: true,
  amount: true,
  to_amount: true,
  date: true,
  category_id: true,
  account_id: true,
  to_account_id: true,
  refunds_transaction_id: true,
} as const;
const TX_SELECT = {
  ...BALANCE_TX_SELECT,
  splits: { select: { category_id: true, amount: true } },
  refund_allocations_sent: {
    select: {
      amount: true,
      expense_transaction: {
        select: {
          amount: true,
          category_id: true,
          splits: { select: { category_id: true, amount: true } },
        },
      },
    },
  },
} as const;
const ACCOUNT_SELECT = {
  id: true,
  name: true,
  type: true,
  currency: true,
  initial_balance: true,
  initial_balance_date: true,
} as const;
const SNAPSHOT_SELECT = { account_id: true, date: true, balance: true } as const;
const HOLDING_SELECT = {
  id: true,
  account_id: true,
  symbol: true,
  name: true,
  asset_class: true,
  currency: true,
  orders: { select: { id: true, side: true, date: true, quantity: true, unit_price: true, fee: true } },
} as const;

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

  const [transactions, accounts, categories, snapshots, holdings] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id }, select: TX_SELECT }),
    prisma.account.findMany({ where: { user_id }, select: ACCOUNT_SELECT }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, name: true, color: true } }),
    prisma.accountSnapshot.findMany({ where: { user_id }, select: SNAPSHOT_SELECT }),
    prisma.holding.findMany({ where: { user_id }, select: HOLDING_SELECT }),
  ]);
  const { rates: fx, degraded: fxDegraded } = await buildFx(accounts, reportCurrency);
  const securities = await securitiesByAccountNow(holdings, accounts);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  // Pas d'arrondi par transaction : les sommes sont arrondies une fois à la
  // sortie (round2), comme dans buildCashflow — sinon l'arrondi cumulé diverge.
  const txValue = (t: Tx, amount = t.amount) => amount * (fx.get(accountById.get(t.account_id ?? -1)?.currency ?? 'EUR') ?? 1);

  const monthTransactions = transactions.filter((t) => t.date >= start && t.date < end);
  const income = monthTransactions
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + txValue(t, Math.max(0, t.amount - refundAllocatedAmount(t))), 0);
  const refunds = monthTransactions.filter(isRefund).reduce((s, t) => s + txValue(t, refundAllocatedAmount(t)), 0);
  const expenses = monthTransactions.filter((t) => t.type === 'expense').reduce((s, t) => s + txValue(t), 0) - refunds;

  const accountBalances = computeAccountBalances(accounts, transactions, snapshots, fx, securities);
  const unassignedBalance = computeUnassignedBalance(transactions);
  // Count income/expense transactions left without an account so the UI can
  // surface them as a fixable anomaly instead of silently folding them into
  // the cash group.
  const unassignedCount = transactions.filter((t) => t.account_id == null && t.type !== 'transfer').length;
  const assets = accountBalances.filter((a) => !a.is_liability).reduce((s, a) => s + a.balance, 0) + unassignedBalance;
  const liabilities = accountBalances.filter((a) => a.is_liability).reduce((s, a) => s + a.balance, 0);
  const netWorth = assets - liabilities;
  const balanceByGroup = buildBalanceByGroup(accountBalances, unassignedBalance);

  // Dépenses par catégorie, nettes des remboursements : un remboursement vient
  // en déduction de la catégorie de la dépense qu'il rembourse (la dépense liée
  // peut être d'un autre mois — on la résout sur l'ensemble des transactions).
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const byCategory = new Map<number | null, number>();
  for (const t of monthTransactions) {
    if (t.type === 'expense') {
      for (const allocation of categoryAllocations(t)) {
        byCategory.set(allocation.category_id, (byCategory.get(allocation.category_id) ?? 0) + txValue(t, allocation.amount));
      }
    } else if (t.type === 'income' && isRefund(t)) {
      const target = t.refunds_transaction_id != null ? txById.get(t.refunds_transaction_id) : undefined;
      for (const allocation of refundCategoryAllocations(t, target)) {
        byCategory.set(allocation.category_id, (byCategory.get(allocation.category_id) ?? 0) - txValue(t, allocation.amount));
      }
    }
  }
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  res.json({
    month,
    currency: reportCurrency,
    exchange_rates: Object.fromEntries(fx.entries()),
    fx_degraded: fxDegraded,
    income: round2(income),
    expenses: round2(expenses),
    net: round2(income - expenses),
    balance: round2(netWorth),
    balance_assets: round2(assets),
    balance_liabilities: round2(liabilities),
    net_worth: round2(netWorth),
    unassigned_balance: round2(unassignedBalance),
    unassigned_count: unassignedCount,
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

  const [transactions, accounts, snapshots, holdings] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id }, select: BALANCE_TX_SELECT }),
    prisma.account.findMany({ where: { user_id }, select: ACCOUNT_SELECT }),
    prisma.accountSnapshot.findMany({ where: { user_id }, select: SNAPSHOT_SELECT }),
    prisma.holding.findMany({ where: { user_id }, select: HOLDING_SELECT }),
  ]);

  const today = startOfUtcDay(new Date());
  const firstDate = firstRelevantDate(accounts, transactions, snapshots) ?? today;

  // Custom range: explicit from/to days (either may be omitted — from falls back
  // to the user's first data point, to falls back to today). Otherwise the
  // preset range maps to a start and ends today.
  const customFrom = range === 'custom' ? parseDayParam(req.query.from) : null;
  const customTo = range === 'custom' ? parseDayParam(req.query.to) : null;
  let from = customFrom ?? rangeStart(range, today, firstDate);
  let to = customTo ?? today;
  if (from > to) [from, to] = [to, from]; // tolerate an inverted range
  const dates = buildHistoryDates(from, to, granularity);

  // Taux par date : un compte USD en 2023 est converti au taux de 2023, pas à
  // celui d'aujourd'hui (cache persistant dans exchange_rates).
  const fxByDate = await buildFxByDate(accounts, reportCurrency, dates);
  // Titres valorisés au cours de chaque date (cache persistant dans market_data).
  const securitiesByDate = await securitiesByAccountByDate(holdings, accounts, dates);

  // One chronological sweep instead of recomputing every account at every date.
  const series = computeWealthSeries(accounts, transactions, snapshots, dates, fxByDate, securitiesByDate);
  const points = dates.map((date, di) => {
    const { accountBalances, unassignedBalance } = series[di]!;
    const assets = accountBalances.filter((a) => !a.is_liability).reduce((s, a) => s + a.balance, 0) + unassignedBalance;
    const liabilities = accountBalances.filter((a) => a.is_liability).reduce((s, a) => s + a.balance, 0);
    const byGroup = buildBalanceByGroup(accountBalances, unassignedBalance).reduce<Record<string, number>>((acc, row) => {
      acc[row.group] = row.signed_amount;
      return acc;
    }, {});
    // Always emit every account in by_account (defaulting to 0 when the
    // account was not yet eligible at this date). recharts treats undefined
    // values as gaps in the line, so an account with a single eligible
    // point would produce no visible line at all.
    const computedById = new Map(accountBalances.map((row) => [row.account_id, row.signed_balance]));
    const byAccount = accounts.reduce<Record<number, number>>((acc, account) => {
      acc[account.id] = round2(computedById.get(account.id) ?? 0);
      return acc;
    }, {});
    return {
      date: dateKey(date),
      currency: reportCurrency,
      assets: round2(assets),
      liabilities: round2(liabilities),
      net_worth: round2(assets - liabilities),
      by_group: byGroup,
      by_account: byAccount,
    };
  });

  res.json(points);
}));

// Solde estimé : pour chaque compte on part du snapshot de solde le plus récent
// (ou du solde initial s'il n'y a pas de snapshot) puis on applique les transactions
// postérieures à cette date. Le solde initial est traité comme une ouverture
// de journée, donc les transactions du même jour comptent aussi.
export function computeAccountBalances(
  accounts: AccountRow[],
  transactions: BalanceTx[],
  snapshots: Array<{ account_id: number; date: Date; balance: number }>,
  fx: Map<string, number>,
  // Valeur de marché des titres par compte (devise du compte), ajoutée au cash.
  securitiesByAccount?: Map<number, number>,
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

  // Index transactions by the account they touch, once, so each account reads
  // only its own movements instead of re-scanning the whole table per account
  // (which made wealth-history O(dates × accounts × transactions)).
  const bySource = new Map<number, BalanceTx[]>();
  const byDest = new Map<number, BalanceTx[]>();
  for (const t of transactions) {
    if (t.account_id != null) {
      const list = bySource.get(t.account_id);
      if (list) list.push(t); else bySource.set(t.account_id, [t]);
    }
    if (t.type === 'transfer' && t.to_account_id != null) {
      const list = byDest.get(t.to_account_id);
      if (list) list.push(t); else byDest.set(t.to_account_id, [t]);
    }
  }

  return accounts.map((account) => {
    const snap = latestSnapshot.get(account.id);
    const base = snap ? snap.balance : account.initial_balance;
    const since = snap ? snap.date : account.initial_balance_date;
    const matches = (txDate: Date) => (snap ? txDate > since : txDate >= since);
    const outgoing = (bySource.get(account.id) ?? [])
      .reduce((s, t) => (matches(t.date) ? s + sourceDelta(t) : s), 0);
    const incoming = (byDest.get(account.id) ?? [])
      .reduce((s, t) => (matches(t.date) ? s + (t.to_amount ?? t.amount) : s), 0);
    const securities = securitiesByAccount?.get(account.id) ?? 0;
    const rawBalance = (base + outgoing + incoming + securities) * (fx.get(account.currency) ?? 1);
    const isLiability = isLiabilityAccount(account.type);
    const balance = isLiability ? Math.abs(rawBalance) : rawBalance;
    return {
      account_id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      type_label: accountTypeLabel(account.type as AccountType),
      group: accountTypeGroup(account.type as AccountType),
      group_label: accountGroupLabel(accountTypeGroup(account.type as AccountType)),
      balance,
      signed_balance: isLiability ? -balance : balance,
      is_liability: isLiability,
    };
  });
}

// Kept as the reference single-date computation that computeWealthSeries is
// validated against (dashboard.test.ts). No longer on the hot path.
export function computeAccountBalancesAt(
  accounts: AccountRow[],
  transactions: BalanceTx[],
  snapshots: Array<{ account_id: number; date: Date; balance: number }>,
  at: Date,
  fx: Map<string, number>,
) {
  const snapshotsUntil = snapshots.filter((s) => s.date <= at);
  const transactionsUntil = transactions.filter((t) => t.date <= at);
  // An account is eligible at `at` if either its initial balance is dated
  // before `at`, or — crucially — a snapshot earlier than `at` exists for
  // it. The latter lets users created in May 2026 still anchor their
  // April balance via a back-dated snapshot.
  const accountsWithEarlierSnap = new Set(snapshotsUntil.map((s) => s.account_id));
  const eligibleAccounts = accounts.filter((a) =>
    a.initial_balance_date <= at || accountsWithEarlierSnap.has(a.id),
  );
  return computeAccountBalances(eligibleAccounts, transactionsUntil, snapshotsUntil, fx);
}

type AccountBalanceRow = ReturnType<typeof computeAccountBalances>[number];

// Per-date account balances + unassigned balance over an ascending date range,
// computed in a single forward sweep instead of recomputing every account from
// scratch at every date. Each account's events (opening balance, its own
// transactions, its snapshots) are merged once and replayed in order, recording
// the running balance at each requested date. Equivalent to calling
// computeAccountBalancesAt for every date, but O(transactions + dates×accounts)
// instead of O(dates × accounts × transactions). Validated against
// computeAccountBalancesAt in dashboard.test.ts.
export function computeWealthSeries(
  accounts: AccountRow[],
  transactions: BalanceTx[],
  snapshots: Array<{ account_id: number; date: Date; balance: number }>,
  dates: Date[],
  // Taux par date (aligné sur `dates`) : chaque date convertit avec le taux qui
  // avait cours ce jour-là plutôt qu'un taux unique appliqué à tout l'historique.
  fxByDate: Map<string, number>[],
  // Valeur de marché des titres par compte et par date (devise du compte).
  securitiesByAccountByDate?: Map<number, number[]>,
): Array<{ accountBalances: AccountBalanceRow[]; unassignedBalance: number }> {
  const bySource = new Map<number, BalanceTx[]>();
  const byDest = new Map<number, BalanceTx[]>();
  for (const t of transactions) {
    if (t.account_id != null) {
      const l = bySource.get(t.account_id); if (l) l.push(t); else bySource.set(t.account_id, [t]);
    }
    if (t.type === 'transfer' && t.to_account_id != null) {
      const l = byDest.get(t.to_account_id); if (l) l.push(t); else byDest.set(t.to_account_id, [t]);
    }
  }
  const snapsByAccount = new Map<number, Array<{ date: Date; balance: number }>>();
  for (const s of snapshots) {
    const l = snapsByAccount.get(s.account_id); if (l) l.push(s); else snapsByAccount.set(s.account_id, [s]);
  }

  // raw[di] is the account's own-currency balance at dates[di], or null before
  // the account is eligible (opening date not reached and no earlier snapshot).
  const rawByAccount = new Map<number, Array<number | null>>();
  for (const account of accounts) {
    rawByAccount.set(account.id, sweepAccount(
      account,
      bySource.get(account.id) ?? [],
      byDest.get(account.id) ?? [],
      snapsByAccount.get(account.id) ?? [],
      dates,
    ));
  }

  // Account-less, non-transfer transactions: a single running sum across dates.
  const unassignedEvents = transactions
    .filter((t) => t.account_id == null && t.type !== 'transfer')
    .map((t) => ({ t: t.date.getTime(), delta: sourceDelta(t) }))
    .sort((a, b) => a.t - b.t);
  const unassignedByDate: number[] = [];
  let uAcc = 0;
  let uIdx = 0;
  for (const date of dates) {
    const dt = date.getTime();
    while (uIdx < unassignedEvents.length && unassignedEvents[uIdx]!.t <= dt) uAcc += unassignedEvents[uIdx++]!.delta;
    unassignedByDate.push(uAcc);
  }

  return dates.map((_, di) => {
    const accountBalances: AccountBalanceRow[] = [];
    for (const account of accounts) {
      const raw = rawByAccount.get(account.id)![di];
      if (raw == null) continue; // not eligible at this date — excluded like computeAccountBalancesAt
      const securities = securitiesByAccountByDate?.get(account.id)?.[di] ?? 0;
      const rawBalance = (raw + securities) * (fxByDate[di]!.get(account.currency) ?? 1);
      const isLiability = isLiabilityAccount(account.type);
      const balance = isLiability ? Math.abs(rawBalance) : rawBalance;
      accountBalances.push({
        account_id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        type_label: accountTypeLabel(account.type as AccountType),
        group: accountTypeGroup(account.type as AccountType),
        group_label: accountGroupLabel(accountTypeGroup(account.type as AccountType)),
        balance,
        signed_balance: isLiability ? -balance : balance,
        is_liability: isLiability,
      });
    }
    return { accountBalances, unassignedBalance: unassignedByDate[di]! };
  });
}

// Replay one account's events over ascending `dates`, returning its raw
// own-currency balance at each date (null until the account becomes eligible).
// Order within a day: opening (0) < transactions (1) < snapshot (2). So a
// same-day transaction is added then discarded by a same-day snapshot
// (snapshots are authoritative and count only strictly-later transactions),
// while the opening balance counts same-day transactions (>= its date). A
// snapshot also supersedes the opening balance, so once any snapshot has been
// seen the opening event no longer resets the running balance.
function sweepAccount(
  account: AccountRow,
  sourceTxns: BalanceTx[],
  transferIns: BalanceTx[],
  snaps: Array<{ date: Date; balance: number }>,
  dates: Date[],
): Array<number | null> {
  type Ev = { t: number; order: 0 | 1 | 2; kind: 'init' | 'tx' | 'snap'; v: number };
  const events: Ev[] = [
    { t: account.initial_balance_date.getTime(), order: 0, kind: 'init', v: account.initial_balance },
  ];
  for (const x of sourceTxns) events.push({ t: x.date.getTime(), order: 1, kind: 'tx', v: sourceDelta(x) });
  for (const x of transferIns) events.push({ t: x.date.getTime(), order: 1, kind: 'tx', v: x.to_amount ?? x.amount });
  for (const s of snaps) events.push({ t: s.date.getTime(), order: 2, kind: 'snap', v: s.balance });
  events.sort((a, b) => a.t - b.t || a.order - b.order);

  const out: Array<number | null> = [];
  let balance = 0;
  let started = false;
  let snapped = false;
  let ei = 0;
  for (const date of dates) {
    const dt = date.getTime();
    while (ei < events.length && events[ei]!.t <= dt) {
      const e = events[ei++]!;
      if (e.kind === 'init') { if (!snapped) balance = e.v; started = true; }
      else if (e.kind === 'snap') { balance = e.v; snapped = true; started = true; }
      else if (started) balance += e.v;
    }
    out.push(started ? balance : null);
  }
  return out;
}

function computeUnassignedBalance(transactions: BalanceTx[]): number {
  // Transactions sans compte : seuls revenus/dépenses comptent (un transfert sans compte n'a pas de sens).
  return transactions
    .filter((t) => t.account_id == null && t.type !== 'transfer')
    .reduce((s, t) => s + sourceDelta(t), 0);
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

// La taxonomie (groupes, labels) vient du shared — source de vérité unique.
// Seul le caractère « passif » reste local : c'est un choix d'agrégation du
// dashboard, pas une propriété affichée.
function isLiabilityAccount(type: string): boolean {
  return type === 'credit' || type === 'loan';
}

function firstRelevantDate(
  accounts: AccountRow[],
  transactions: BalanceTx[],
  snapshots: Array<{ date: Date }>,
): Date | null {
  const dates = [
    ...accounts.map((a) => a.initial_balance_date),
    ...transactions.map((t) => t.date),
    ...snapshots.map((s) => s.date),
  ].sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}

// Parse a YYYY-MM-DD query param to a UTC day, or null when absent/invalid.
function parseDayParam(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : startOfUtcDay(date);
}

function rangeStart(range: string, today: Date, firstDate: Date): Date {
  if (range === '1m') return addMonthsUtc(today, -1);
  if (range === '6m') return addMonthsUtc(today, -6);
  if (range === 'ytd') return new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  if (range === 'all') return firstDate;
  return addMonthsUtc(today, -12);
}

function buildHistoryDates(from: Date, to: Date, granularity: string): Date[] {
  const dates: Date[] = [];
  const end = startOfUtcDay(to);

  if (granularity === 'month') {
    // Snap each monthly data point to the LAST day of the month so an
    // end-of-month snapshot (the natural saisie convention) shows up
    // exactly at its month's marker, instead of bleeding into the next.
    // Months still in progress get represented by today's date as a final
    // partial point.
    const cursor = startOfUtcDay(from);
    cursor.setUTCDate(1);
    while (true) {
      const endOfMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
      if (endOfMonth > end) break;
      if (endOfMonth >= startOfUtcDay(from)) dates.push(endOfMonth);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    if (dates.length === 0 || dateKey(dates[dates.length - 1]!) !== dateKey(end)) {
      dates.push(end);
    }
    return dates;
  }

  const cursor = startOfUtcDay(from);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    if (granularity === 'day') {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }
  if (dates.length === 0 || dateKey(dates[dates.length - 1]!) !== dateKey(end)) dates.push(end);
  return dates;
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
    const rate = fx.get(accountById.get(t.account_id ?? -1)?.currency ?? 'EUR') ?? 1;
    if (t.type === 'income') {
      const refundAmount = refundAllocatedAmount(t);
      if (refundAmount > 0) bucket.expenses -= refundAmount * rate;
      if (t.amount > refundAmount) bucket.income += (t.amount - refundAmount) * rate;
    }
    if (t.type === 'expense') bucket.expenses += t.amount * rate;
    bucket.net = bucket.income - bucket.expenses;
  }
  let cumulativeNet = 0;
  return Array.from(buckets.values()).map((b) => {
    cumulativeNet += b.net;
    return {
      month: b.month,
      income: round2(b.income),
      expenses: round2(b.expenses),
      expenses_signed: round2(-b.expenses),
      net: round2(b.net),
      cumulative_net: round2(cumulativeNet),
    };
  });
}

function buildYearlyCashflow(transactions: Tx[], accountById: Map<number, AccountRow>, fx: Map<string, number>) {
  const byYear = new Map<string, { year: string; income: number; expenses: number; net: number }>();
  for (const transaction of transactions) {
    const year = transaction.date.toISOString().slice(0, 4);
    const row = byYear.get(year) ?? { year, income: 0, expenses: 0, net: 0 };
    const rate = fx.get(accountById.get(transaction.account_id ?? -1)?.currency ?? 'EUR') ?? 1;
    if (transaction.type === 'income') {
      const refundAmount = refundAllocatedAmount(transaction);
      if (refundAmount > 0) row.expenses -= refundAmount * rate;
      if (transaction.amount > refundAmount) row.income += (transaction.amount - refundAmount) * rate;
    }
    if (transaction.type === 'expense') row.expenses += transaction.amount * rate;
    row.net = row.income - row.expenses;
    byYear.set(year, row);
  }
  return Array.from(byYear.values())
    .map((r) => ({ year: r.year, income: round2(r.income), expenses: round2(r.expenses), net: round2(r.net) }))
    .sort((a, b) => a.year.localeCompare(b.year));
}
