import { Router } from 'express';
import { accountGroupLabel, accountGroupOf, accountTypeLabel, type AccountType } from '@suzanne/shared';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { currencyQuery, idParam, monthString } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { buildFx } from '../lib/fxHelper.js';
import { buildFxByDate } from '../lib/fxStore.js';
import { securitiesByAccountByDate, securitiesByAccountNow } from '../lib/holdingsValuation.js';
import { categoryTypeLookup, LEDGER_TX_SELECT, professionalAccountFilter, txFlows, type LedgerTx } from '../lib/ledger.js';
import { addMonthsUtc, dateKey, startOfUtcDay } from '../lib/dates.js';

export const dashboardRouter = Router();

// Opération telle que lue par les agrégations : genre + lignes signées.
type BalanceTx = Pick<LedgerTx, 'id' | 'kind' | 'date' | 'refunds_transaction_id' | 'lines'>;
type AccountRow = { id: number; name: string; type: string; currency: string; initial_balance: number; initial_balance_date: Date };
type Move = { date: Date; amount: number };

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  type: true,
  professional: true,
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

// Mouvements par compte (somme des lignes de chaque compte, quel que soit le
// genre de l'opération) et mouvements « hors compte » (lignes sans compte des
// dépenses/revenus, à affecter).
function accountMoves(transactions: BalanceTx[]): { byAccount: Map<number, Move[]>; unassigned: Move[] } {
  const byAccount = new Map<number, Move[]>();
  const unassigned: Move[] = [];
  for (const t of transactions) {
    for (const line of t.lines) {
      if (line.account_id != null) {
        const list = byAccount.get(line.account_id);
        if (list) list.push({ date: t.date, amount: line.amount }); else byAccount.set(line.account_id, [{ date: t.date, amount: line.amount }]);
      } else if (t.kind === 'standard') {
        unassigned.push({ date: t.date, amount: line.amount });
      }
    }
  }
  return { byAccount, unassigned };
}

dashboardRouter.get('/users/:user_id/dashboard', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

  const [transactions, accounts, categories, snapshots, holdings] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id }, select: LEDGER_TX_SELECT }),
    prisma.account.findMany({ where: { user_id }, select: ACCOUNT_SELECT }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, name: true, color: true, type: true } }),
    prisma.accountSnapshot.findMany({ where: { user_id }, select: SNAPSHOT_SELECT }),
    prisma.holding.findMany({ where: { user_id }, select: HOLDING_SELECT }),
  ]);
  const { rates: fx, degraded: fxDegraded } = await buildFx(accounts, reportCurrency);
  const securities = await securitiesByAccountNow(holdings, accounts);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryType = categoryTypeLookup(categories);
  const excluded = await professionalAccountFilter(user_id);
  // Pas d'arrondi par ligne : les sommes sont arrondies une fois à la sortie.
  const rateOf = (accountId: number | null) => fx.get(accountById.get(accountId ?? -1)?.currency ?? 'EUR') ?? 1;

  let income = 0;
  let expenses = 0;
  const byCategory = new Map<number | null, number>();
  for (const t of transactions) {
    if (t.date < start || t.date >= end) continue;
    for (const flow of txFlows(t, categoryType, excluded)) {
      const value = flow.value * rateOf(flow.account_id);
      if (flow.side === 'income') income += value;
      else {
        expenses += value;
        // Dépenses par catégorie, nettes des remboursements (lignes positives).
        byCategory.set(flow.category_id, (byCategory.get(flow.category_id) ?? 0) + value);
      }
    }
  }

  const accountBalances = computeAccountBalances(accounts, transactions, snapshots, fx, securities);
  const unassignedBalance = computeUnassignedBalance(transactions);
  // Dépenses/revenus sans compte : signalés comme anomalie corrigeable.
  const unassignedCount = transactions.filter((t) => t.kind === 'standard' && t.lines.some((l) => l.account_id == null)).length;
  const assets = accountBalances.filter((a) => !a.is_liability).reduce((s, a) => s + a.balance, 0) + unassignedBalance;
  const liabilities = accountBalances.filter((a) => a.is_liability).reduce((s, a) => s + a.balance, 0);
  const netWorth = assets - liabilities;
  const balanceByGroup = buildBalanceByGroup(accountBalances, unassignedBalance);
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
    monthly_cashflow: buildCashflow(transactions, start, categoryType, rateOf, excluded),
    yearly_cashflow: buildYearlyCashflow(transactions, categoryType, rateOf, excluded),
    expenses_by_category: Array.from(byCategory.entries()).map(([category_id, amount]) => {
      const category = category_id ? categoryById.get(category_id) : null;
      return { category_id, name: category?.name ?? 'Sans catégorie', color: category?.color ?? '#9ca3af', amount: round2(amount) };
    }).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
  });
}));

dashboardRouter.get('/users/:user_id/wealth-history', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const range = String(req.query.range ?? '12m');
  const granularity = String(req.query.granularity ?? 'month');
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');

  const [transactions, accounts, snapshots, holdings] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id }, select: LEDGER_TX_SELECT }),
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
): AccountBalanceRow[] {
  const latestSnapshot = new Map<number, { date: Date; balance: number }>();
  for (const s of snapshots) {
    const current = latestSnapshot.get(s.account_id);
    if (!current || s.date > current.date) latestSnapshot.set(s.account_id, { date: s.date, balance: s.balance });
  }
  const { byAccount } = accountMoves(transactions);
  return accounts.map((account) => {
    const snap = latestSnapshot.get(account.id);
    const base = snap ? snap.balance : account.initial_balance;
    const since = snap ? snap.date : account.initial_balance_date;
    // Relevé = fin de journée (mouvements strictement après) ; solde initial =
    // ouverture de journée (mouvements du jour inclus).
    const matches = (date: Date) => (snap ? date > since : date >= since);
    const moved = (byAccount.get(account.id) ?? []).reduce((sum, m) => (matches(m.date) ? sum + m.amount : sum), 0);
    const securities = securitiesByAccount?.get(account.id) ?? 0;
    return balanceRow(account, base + moved + securities, fx);
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
  // Éligible « en avant » : solde initial daté ≤ at, ou relevé ≤ at (un compte
  // créé en mai peut ancrer avril via un relevé antidaté).
  const accountsWithEarlierSnap = new Set(snapshotsUntil.map((s) => s.account_id));
  const forward = new Set(accounts.filter((a) => a.initial_balance_date <= at || accountsWithEarlierSnap.has(a.id)).map((a) => a.id));
  const forwardRows = new Map(
    computeAccountBalances(accounts.filter((a) => forward.has(a.id)), transactionsUntil, snapshotsUntil, fx)
      .map((row) => [row.account_id, row]),
  );
  // Avant toute ancre : reconstruction à rebours depuis la première ancre, si le
  // compte a déjà au moins un mouvement à cette date.
  const { byAccount } = accountMoves(transactions);
  return accounts.flatMap((account) => {
    const row = forwardRows.get(account.id);
    if (row) return [row];
    const moves = byAccount.get(account.id) ?? [];
    if (!moves.some((m) => m.date <= at)) return [];
    const firstSnap = snapshots.filter((s) => s.account_id === account.id).sort((a, b) => a.date.getTime() - b.date.getTime())[0];
    const anchorIsInit = !firstSnap || account.initial_balance_date <= firstSnap.date;
    const anchorDate = anchorIsInit ? account.initial_balance_date : firstSnap!.date;
    const anchorValue = anchorIsInit ? account.initial_balance : firstSnap!.balance;
    const between = moves
      .filter((m) => m.date > at && (anchorIsInit ? m.date < anchorDate : m.date <= anchorDate))
      .reduce((sum, m) => sum + m.amount, 0);
    return [balanceRow(account, anchorValue - between, fx)];
  });
}

function balanceRow(account: AccountRow, raw: number, fx: Map<string, number>) {
  const rawBalance = raw * (fx.get(account.currency) ?? 1);
  const isLiability = isLiabilityAccount(account.type);
  const balance = isLiability ? Math.abs(rawBalance) : rawBalance;
  return {
    account_id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    type_label: accountTypeLabel(account.type as AccountType),
    group: accountGroupOf(account),
    group_label: accountGroupLabel(accountGroupOf(account)),
    balance,
    signed_balance: isLiability ? -balance : balance,
    is_liability: isLiability,
  };
}

type AccountBalanceRow = ReturnType<typeof balanceRow>;

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
  const { byAccount, unassigned } = accountMoves(transactions);
  const snapsByAccount = new Map<number, Array<{ date: Date; balance: number }>>();
  for (const s of snapshots) {
    const l = snapsByAccount.get(s.account_id); if (l) l.push(s); else snapsByAccount.set(s.account_id, [s]);
  }

  // raw[di] is the account's own-currency balance at dates[di], or null before
  // the account is eligible (opening date not reached and no earlier snapshot).
  const rawByAccount = new Map<number, Array<number | null>>();
  for (const account of accounts) {
    rawByAccount.set(account.id, sweepAccount(account, byAccount.get(account.id) ?? [], snapsByAccount.get(account.id) ?? [], dates));
  }

  // Account-less, non-transfer transactions: a single running sum across dates.
  const unassignedEvents = unassigned
    .map((m) => ({ t: m.date.getTime(), delta: m.amount }))
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
        group: accountGroupOf(account),
        group_label: accountGroupLabel(accountGroupOf(account)),
        balance,
        signed_balance: isLiability ? -balance : balance,
        is_liability: isLiability,
      });
    }
    return { accountBalances, unassignedBalance: unassignedByDate[di]! };
  });
}

// Solde brut (devise du compte) d'un compte à chaque date de `dates` (fin de
// journée), ou null tant que le compte n'existe pas encore.
//
// Modèle « ancres » : le solde initial (ouverture du jour D, avant les
// mouvements de D) et chaque relevé de solde (fin du jour S) sont des soldes
// CONNUS. À une date t :
// - s'il existe une ancre ≤ t, on part de la plus récente (un relevé l'emporte
//   toujours sur le solde initial) et on avance avec les mouvements postérieurs ;
// - sinon (t avant toute ancre — ex. historique importé après coup, antérieur
//   au solde saisi), on RECULE depuis la première ancre : solde connu moins les
//   mouvements situés entre t et l'ancre. Le compte apparaît dès son premier
//   mouvement. Importer des opérations passées ne modifie donc jamais le solde
//   actuel ni les soldes saisis : ça ne fait que remplir l'historique.
function sweepAccount(
  account: AccountRow,
  accountMovesList: Move[],
  snaps: Array<{ date: Date; balance: number }>,
  dates: Date[],
): Array<number | null> {
  const moves = accountMovesList.map((m) => ({ t: m.date.getTime(), v: m.amount })).sort((a, b) => a.t - b.t);
  const prefix = [0];
  for (const m of moves) prefix.push(prefix[prefix.length - 1]! + m.v);
  // Somme des mouvements de date dans ]lo, hi] (hiInclusive) ou ]lo, hi[.
  const upperIndex = (t: number, inclusive: boolean) => {
    let lo = 0; let hi = moves.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (inclusive ? moves[mid]!.t <= t : moves[mid]!.t < t) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const sumBetween = (afterT: number, untilT: number, untilInclusive: boolean) =>
    prefix[upperIndex(untilT, untilInclusive)]! - prefix[upperIndex(afterT, true)]!;

  const init = { t: account.initial_balance_date.getTime(), v: account.initial_balance };
  const sortedSnaps = snaps.map((x) => ({ t: x.date.getTime(), v: x.balance })).sort((a, b) => a.t - b.t);
  const firstSnap = sortedSnaps[0];
  // Première ancre chronologique (à égalité de jour, l'ouverture précède le relevé).
  const firstAnchor = !firstSnap || init.t <= firstSnap.t
    ? { kind: 'init' as const, ...init }
    : { kind: 'snap' as const, ...firstSnap };
  const firstMove = moves[0]?.t ?? Infinity;
  const existsFrom = Math.min(firstAnchor.t, firstMove);

  const out: Array<number | null> = [];
  let si = -1; // index du dernier relevé ≤ date courante
  for (const date of dates) {
    const dt = date.getTime();
    while (si + 1 < sortedSnaps.length && sortedSnaps[si + 1]!.t <= dt) si += 1;
    if (dt < existsFrom) { out.push(null); continue; }
    if (si >= 0) {
      const snap = sortedSnaps[si]!;
      out.push(snap.v + sumBetween(snap.t, dt, true));
    } else if (init.t <= dt) {
      // Ouverture : les mouvements du jour D comptent (>= D).
      out.push(init.v + sumBetween(init.t - 1, dt, true));
    } else if (firstAnchor.kind === 'init') {
      // Avant l'ouverture : solde d'ouverture moins les mouvements de ]t, D[.
      out.push(firstAnchor.v - sumBetween(dt, firstAnchor.t, false));
    } else {
      // Avant le premier relevé : relevé moins les mouvements de ]t, S].
      out.push(firstAnchor.v - sumBetween(dt, firstAnchor.t, true));
    }
  }
  return out;
}

function computeUnassignedBalance(transactions: BalanceTx[]): number {
  // Lignes sans compte des dépenses/revenus (un virement sans compte n'a pas de sens).
  return accountMoves(transactions).unassigned.reduce((s, m) => s + m.amount, 0);
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

type RateOf = (accountId: number | null) => number;
type CategoryTypeOf = Parameters<typeof txFlows>[1];
type Excluded = Parameters<typeof txFlows>[2];

function buildCashflow(transactions: BalanceTx[], endMonth: Date, categoryType: CategoryTypeOf, rateOf: RateOf, excluded?: Excluded) {
  const buckets = new Map<string, { month: string; income: number; expenses: number; net: number }>();
  for (let i = 11; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(endMonth.getUTCFullYear(), endMonth.getUTCMonth() - i, 1));
    const key = start.toISOString().slice(0, 7);
    buckets.set(key, { month: key, income: 0, expenses: 0, net: 0 });
  }
  for (const t of transactions) {
    const bucket = buckets.get(t.date.toISOString().slice(0, 7));
    if (!bucket) continue;
    for (const flow of txFlows(t, categoryType, excluded)) {
      if (flow.side === 'income') bucket.income += flow.value * rateOf(flow.account_id);
      else bucket.expenses += flow.value * rateOf(flow.account_id);
    }
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

function buildYearlyCashflow(transactions: BalanceTx[], categoryType: CategoryTypeOf, rateOf: RateOf, excluded?: Excluded) {
  const byYear = new Map<string, { year: string; income: number; expenses: number; net: number }>();
  for (const t of transactions) {
    const year = t.date.toISOString().slice(0, 4);
    const row = byYear.get(year) ?? { year, income: 0, expenses: 0, net: 0 };
    for (const flow of txFlows(t, categoryType, excluded)) {
      if (flow.side === 'income') row.income += flow.value * rateOf(flow.account_id);
      else row.expenses += flow.value * rateOf(flow.account_id);
    }
    row.net = row.income - row.expenses;
    byYear.set(year, row);
  }
  return Array.from(byYear.values())
    .map((r) => ({ year: r.year, income: round2(r.income), expenses: round2(r.expenses), net: round2(r.net) }))
    .sort((a, b) => a.year.localeCompare(b.year));
}
