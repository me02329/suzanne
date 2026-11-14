import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  nextRecurringOccurrence,
  type Account,
  type BillsStatusSummary,
  type Budget,
  type BudgetStatus,
  type Category,
  type DashboardSummary,
  type RecurringTransaction,
  type Transaction,
} from '@suzanne/shared';
import { useTranslation } from 'react-i18next';
import { currentMonthIso, formatMonth, formatMonthLong, formatRelativeDate, money as moneyFmt } from '../lib/format';
import { seriesColor, useChartTheme } from '../lib/chartTheme';
import { CADENCE_META, cadenceAmount, cadenceOf, cadenceTotals } from '../lib/subscriptions';
import { useBudgetStatus } from '../components/home/useBudgetStatus';
import { TransactionList } from '../components/TransactionList';
import '../styles/pages/plan.css';
import '../styles/pages/home.css';

const UPCOMING_DAYS = 14;

// « Aperçu » : la synthèse du mois sélectionné. Chaque bloc renvoie vers sa
// page de référence (budgets, factures, récurrents…) — c'est là qu'on agit.
export function Dashboard({ summary, transactions, budgets, recurring, billsStatus, reportCurrency, categoryById, accountById, userId, budgetStatus }: {
  summary: DashboardSummary | null;
  transactions: Transaction[];
  budgets: Budget[];
  recurring: RecurringTransaction[];
  billsStatus: BillsStatusSummary | null;
  reportCurrency: string;
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  /** Optionnels : sans eux, le statut des budgets est chargé ici. */
  userId?: number | null;
  budgetStatus?: BudgetStatus[] | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const chartTheme = useChartTheme();
  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const signedMoney = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`;

  // « Budget consommé » : uniquement les catégories budgétées, dans la devise
  // de rapport, report d'enveloppe compris → statut calculé par l'API.
  const budgetRows = useBudgetStatus({
    userId: userId ?? budgets[0]?.user_id ?? null,
    month: summary?.month,
    currency: displayCurrency,
    provided: budgetStatus,
    refreshKey: summary,
  });

  const monthRows = (summary?.monthly_cashflow ?? []).map((row) => ({ ...row, label: formatMonth(row.month) }));
  const monthIdx = monthRows.findIndex((row) => row.month === summary?.month);
  const prevMonthRow = monthIdx > 0 ? monthRows[monthIdx - 1]! : null;
  const savingRate = summary && summary.income > 0 ? Math.round((summary.net / summary.income) * 100) : null;
  const prevSavingRate = prevMonthRow && prevMonthRow.income > 0 ? Math.round((prevMonthRow.net / prevMonthRow.income) * 100) : null;
  const netWorth = summary?.net_worth ?? summary?.balance ?? 0;
  const netMonthly = summary?.net ?? 0;
  const monthLabel = summary?.month ? formatMonthLong(summary.month) : t('accueil.selected_month');
  const prevLabel = prevMonthRow ? formatMonth(prevMonthRow.month) : '';

  // Variation vs mois précédent, colorée selon le sens favorable.
  const delta = (current: number, previous: number | null | undefined, goodWhen: 'up' | 'down') => {
    if (previous == null || !prevMonthRow) return null;
    const diff = current - previous;
    if (Math.abs(diff) < 0.005) return <>= {prevLabel}</>;
    const tone = (diff > 0) === (goodWhen === 'up') ? 'income' : 'expense';
    const pct = Math.abs(previous) >= 0.005 ? `${Math.abs(Math.round((diff / Math.abs(previous)) * 100))} %` : signedMoney(diff);
    return <><span className={tone}>{diff > 0 ? '↑' : '↓'} {pct}</span>  {t('accueil.dashboard.vs')} {prevLabel}</>;
  };

  const sparkData = monthRows.filter((row) => Number.isFinite(row.cumulative_net));

  // ---- Budgets -----------------------------------------------------------
  const budgetLimit = (budgetRows ?? []).reduce((sum, b) => sum + Math.max(0, b.effective_limit), 0);
  const budgetSpent = (budgetRows ?? []).reduce((sum, b) => sum + b.spent, 0);
  const budgetRatio = budgetLimit > 0 ? budgetSpent / budgetLimit : null;
  const isCurrentMonth = summary?.month === currentMonthIso();
  const budgetAlerts = (budgetRows ?? [])
    .map((b) => {
      const ratio = b.effective_limit > 0 ? b.spent / b.effective_limit : b.spent > 0 ? Infinity : 0;
      return { b, ratio, forecast: isCurrentMonth ? overshootDay(b.spent, b.effective_limit, summary!.month) : null };
    })
    .filter((row) => row.ratio >= 0.8)
    .sort((a, b) => b.ratio - a.ratio);

  // ---- À venir : factures dues non réglées + récurrents des 14 prochains jours
  const rateFor = (accountId: number | null) => {
    const currency = (accountId != null ? accountById.get(accountId)?.currency : null) ?? 'EUR';
    return (summary?.exchange_rates ?? {})[currency] ?? 1;
  };
  const upcoming = [
    ...(billsStatus?.bills ?? [])
      .filter((e) => e.due && e.bill.active && (e.status === 'pending' || e.status === 'late') && e.expected_date)
      .map((e) => ({
        key: `b${e.bill.id}`,
        date: e.expected_date!.slice(0, 10),
        label: e.bill.name,
        sub: e.status === 'late' ? t('accueil.overdue_bill') : t('accueil.bill'),
        amount: -((e.bill.amount_min + e.bill.amount_max) / 2),
        approx: true,
        currency: e.bill.account_id != null ? accountById.get(e.bill.account_id)?.currency ?? 'EUR' : 'EUR',
        late: e.status === 'late',
        to: '/bills',
      })),
    ...recurring
      .filter((r) => r.active)
      .map((r) => ({ r, date: nextRecurringOccurrence(r) }))
      .filter((x): x is { r: RecurringTransaction; date: string } => {
        const days = formatRelativeDate(x.date).days;
        return days != null && days >= 0 && days <= UPCOMING_DAYS;
      })
      .map(({ r, date }) => ({
        key: `r${r.id}`,
        date,
        label: r.description,
        sub: formatRelativeDate(date).label.replace(/^.*\((.*)\)$/, '$1'),
        amount: r.type === 'income' ? r.amount : -r.amount,
        approx: false,
        currency: accountById.get(r.account_id ?? -1)?.currency ?? 'EUR',
        late: false,
        to: '/recurring',
      })),
  ].sort((a, b) => Number(b.late) - Number(a.late) || a.date.localeCompare(b.date));
  const visibleUpcoming = upcoming.slice(0, 6);

  const activeExpenseRecurring = recurring.filter((r) => r.active && r.type === 'expense');
  const subTotals = cadenceTotals(activeExpenseRecurring, rateFor);
  const biggestSub = activeExpenseRecurring
    .map((r) => ({ r, unit: CADENCE_META[cadenceOf(r)].unit, report: cadenceAmount(r) * rateFor(r.account_id) }))
    .sort((a, b) => b.report - a.report)[0];

  // ---- Catégories & grosses dépenses ------------------------------------
  const categoryRows = (summary?.expenses_by_category ?? []).filter((row) => row.amount > 0).sort((a, b) => b.amount - a.amount);
  const topCategories = categoryRows.slice(0, 6);
  const maxCategory = topCategories[0]?.amount ?? 0;
  const otherCategories = categoryRows.slice(6).reduce((sum, row) => sum + row.amount, 0);
  const topExpenses = transactions.filter((tx) => tx.type === 'expense' && !accountById.get(tx.account_id ?? -1)?.professional).sort((a, b) => b.amount - a.amount).slice(0, 5);

  return (
    <section className="pg home">
      <div className="home-hero">
        <div className="home-hero-main">
          <span className="pg-kicker">{t('accueil.net_worth')}</span>
          <strong className="home-hero-value">{money(netWorth)}</strong>
          <div className="home-hero-split">
            <span>{t('commun.assets')} <b>{money(summary?.balance_assets ?? 0)}</b></span>
            <span>{t('commun.liabilities')} <b>{money(summary?.balance_liabilities ?? 0)}</b></span>
          </div>
          <div className="home-hero-net">
            <span>{t('accueil.net_flow')} · {monthLabel}</span>
            <strong className={netMonthly > 0 ? 'income' : netMonthly < 0 ? 'expense' : undefined}>{signedMoney(netMonthly)}</strong>
            {prevMonthRow && <small>{delta(netMonthly, prevMonthRow.net, 'up')}</small>}
          </div>
        </div>
        {sparkData.length > 1 && (
          <div className="home-hero-spark" aria-hidden="true">
            <span>{t('accueil.cumulative_net_flows')} · {sparkData.length} {t('accueil.months')}</span>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 6, right: 2, bottom: 2, left: 2 }}>
                <defs>
                  <linearGradient id="homeSpark" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartTheme.total} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={chartTheme.total} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  formatter={(value) => money(Number(value))}
                  labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.label ?? '')}
                  contentStyle={chartTheme.tooltip.contentStyle}
                  labelStyle={chartTheme.tooltip.labelStyle}
                  itemStyle={chartTheme.tooltip.itemStyle}
                  cursor={{ stroke: chartTheme.axis, strokeDasharray: '3 3' }}
                />
                <Area type="monotone" dataKey="cumulative_net" name={t('accueil.cumulative')} stroke={chartTheme.total} strokeWidth={1.75} fill="url(#homeSpark)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="pg-stats">
        <Link className="pg-stat" to="/transactions?type=income">
          <span>{t('commun.income')}</span>
          <strong className="income">{money(summary?.income ?? 0)}</strong>
          {prevMonthRow && <small>{delta(summary?.income ?? 0, prevMonthRow.income, 'up')}</small>}
        </Link>
        <Link className="pg-stat" to="/transactions?type=expense">
          <span>{t('commun.expenses')}</span>
          <strong className="expense">{money(summary?.expenses ?? 0)}</strong>
          {prevMonthRow && <small>{delta(summary?.expenses ?? 0, prevMonthRow.expenses, 'down')}</small>}
        </Link>
        <div className="pg-stat">
          <span>{t('accueil.savings_rate')}</span>
          <strong title={savingRate != null && savingRate < -100 ? t('accueil.expenses_well_above_this_month', { n: savingRate }) : undefined}>
            {savingRate == null ? '—' : savingRate < -100 ? '< −100 %' : `${savingRate} %`}
          </strong>
          {savingRate != null && prevSavingRate != null && savingRate >= -100 && prevSavingRate >= -100 && (
            <small>
              <span className={savingRate >= prevSavingRate ? 'income' : 'expense'}>
                {savingRate === prevSavingRate ? '=' : savingRate > prevSavingRate ? '↑' : '↓'} {Math.abs(savingRate - prevSavingRate)}  {t('accueil.dashboard.pts')}
              </span>  {t('accueil.dashboard.vs')} {prevLabel}
            </small>
          )}
        </div>
        <Link className="pg-stat" to="/transactions">
          <span>{t('accueil.transactions')}</span>
          <strong>{transactions.length}</strong>
          <small>{monthLabel}</small>
        </Link>
      </div>

      <div className="home-grid">
        <div className="home-col">
          <div className="pg-card">
            <div className="pg-card-head">
              <h2>{t('accueil.budgets')}</h2>
              <Link className="home-link" to="/budgets">{t('accueil.view')} <ArrowRight size={14} /></Link>
            </div>
            <div className="pg-card-body">
              {budgetRows == null ? (
                <p className="pg-note">{t('accueil.loading')}</p>
              ) : budgetRows.length === 0 ? (
                <p className="pg-note">{t('accueil.no_budget_this_month')} <Link to="/budgets">{t('accueil.set_limits')}</Link></p>
              ) : (
                <>
                  <div className="home-budget-figure">
                    <strong>{money(budgetSpent)} <small>/ {money(budgetLimit)}</small></strong>
                    <span>{budgetRatio == null ? '—' : `${Math.round(budgetRatio * 100)} % ${t('accueil.used')}`}</span>
                  </div>
                  <div className={`meter big${budgetRatio != null && budgetRatio >= 1 ? ' over' : budgetRatio != null && budgetRatio >= 0.8 ? ' warn' : ''}`}>
                    <span style={{ width: `${Math.max(0, Math.min(100, (budgetRatio ?? 0) * 100))}%` }} />
                  </div>
                </>
              )}
            </div>
            {budgetAlerts.length > 0 && (
              <ul className="home-list">
                {budgetAlerts.slice(0, 3).map(({ b, ratio, forecast }) => {
                  const name = categoryById.get(b.category_id)?.name ?? t('commun.category');
                  const over = ratio >= 1;
                  return (
                    <li key={b.id}>
                      <button type="button" className="home-item" onClick={() => navigate(`/transactions?category=${b.category_id}`)}>
                        <span className="home-swatch" style={{ background: over ? 'var(--expense)' : '#c0922a' }} />
                        <span className="home-item-label">
                          <span title={name}>{name}</span>
                          <small>
                            {money(b.spent)} / {money(b.effective_limit)}
                            {over ? ` · ${t('accueil.over_by_amount', { amount: money(b.spent - b.effective_limit) })}` : forecast ? ` · ${t('accueil.overshoot_expected_on_date', { date: forecast })}` : ''}
                          </small>
                        </span>
                        <strong className={over ? 'expense' : undefined}>{ratio === Infinity ? '∞' : `${Math.round(ratio * 100)} %`}</strong>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {budgetAlerts.length > 3 && <p className="home-foot">+{budgetAlerts.length - 3} {t('accueil.other_budgets_on_alert')}</p>}
          </div>

          <div className="pg-card">
            <div className="pg-card-head">
              <h2>{t('accueil.upcoming')}</h2>
              <Link className="home-link" to="/bills">{t('accueil.bills')} <ArrowRight size={14} /></Link>
            </div>
            {visibleUpcoming.length === 0 ? (
              <p className="pg-empty">{t('accueil.nothing_expected_in_next_14')}</p>
            ) : (
              <ul className="home-list">
                {visibleUpcoming.map((item) => {
                  const [, m, d] = item.date.split('-');
                  return (
                    <li key={item.key}>
                      <Link className="home-item" to={item.to}>
                        <span className={item.late ? 'home-date late' : 'home-date'}>{d}<small>{monthShort(Number(m))}</small></span>
                        <span className="home-item-label">
                          <span title={item.label}>{item.label}</span>
                          <small>{item.sub}</small>
                        </span>
                        <strong className={item.amount >= 0 ? 'income' : item.late ? 'expense' : undefined}>
                          {item.approx ? '≈ ' : item.amount >= 0 ? '+' : '−'}{moneyFmt(Math.abs(item.amount), item.currency)}
                        </strong>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {activeExpenseRecurring.length > 0 && (
              <p className="home-foot">
                {t('accueil.subscriptions')} <strong>{money(subTotals.monthly)}</strong> / {t('accueil.months')}
                {subTotals.periodic > 0 && <> · <strong>{money(subTotals.periodic)}</strong> / {t('accueil.yr')}</>}
                {biggestSub && <> · {t('accueil.the_most_expensive')} : {biggestSub.r.description} ({money(biggestSub.report)}{biggestSub.unit})</>}
              </p>
            )}
          </div>
        </div>

        <div className="home-col">
          <div className="pg-card">
            <div className="pg-card-head">
              <h2>{t('accueil.where_money_goes')}</h2>
              <Link className="home-link" to="/statistics">{t('accueil.analysis')} <ArrowRight size={14} /></Link>
            </div>
            {topCategories.length === 0 ? (
              <p className="pg-empty">{t('accueil.no_expenses_this_month')}</p>
            ) : (
              <ul className="home-list">
                {topCategories.map((row, index) => {
                  const color = seriesColor(chartTheme, index);
                  const content = (
                    <>
                      <span className="home-swatch" style={{ background: color }} />
                      <span className="home-item-label"><span title={row.name}>{row.name}</span></span>
                      <strong>{money(row.amount)}</strong>
                      <span className="meter"><span style={{ width: `${maxCategory > 0 ? (row.amount / maxCategory) * 100 : 0}%`, background: color }} /></span>
                    </>
                  );
                  return (
                    <li key={row.category_id ?? row.name}>
                      {row.category_id != null
                        ? <Link className="home-item" to={`/transactions?category=${row.category_id}`}>{content}</Link>
                        : <div className="home-item">{content}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
            {otherCategories > 0 && <p className="home-foot">+ {money(otherCategories)} {t('accueil.in')} {categoryRows.length - 6} {t('accueil.other_categories')}</p>}
          </div>

          <div className="pg-card">
            <div className="pg-card-head">
              <h2>{t('accueil.largest_expenses')}</h2>
              <Link className="home-link" to="/transactions">{t('accueil.journal')} <ArrowRight size={14} /></Link>
            </div>
            <div className="pg-card-body">
              {topExpenses.length === 0 ? (
                <p className="pg-note">{t('accueil.no_expenses_this_month')}</p>
              ) : (
                <TransactionList
                  transactions={topExpenses}
                  categoryById={categoryById}
                  accountById={accountById}
                  onPick={(tx) => navigate(`/transactions?tx=${tx.id}`)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const MONTHS_SHORT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const monthShort = (m: number) => MONTHS_SHORT[m - 1] ?? '';

// Projection linéaire du jour de dépassement d'un budget pour le mois en cours,
// à partir du rythme observé (dates LOCALES). Renvoie « jj/mm » ou null.
export function overshootDay(spent: number, limit: number, month: string, now: Date = new Date()): string | null {
  if (limit <= 0 || spent <= 0 || spent >= limit) return null;
  const [year, mon] = month.split('-').map(Number) as [number, number];
  if (now.getFullYear() !== year || now.getMonth() + 1 !== mon) return null;
  const daysInMonth = new Date(year, mon, 0).getDate();
  const today = now.getDate();
  const day = today + Math.ceil((limit - spent) / (spent / today));
  if (day > daysInMonth) return null;
  return `${String(day).padStart(2, '0')}/${String(mon).padStart(2, '0')}`;
}
