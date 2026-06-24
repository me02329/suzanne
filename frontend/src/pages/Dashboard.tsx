import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  Banknote,
  CreditCard,
  Euro,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type {
  Account,
  BillsStatusSummary,
  Budget,
  Category,
  DashboardSummary,
  RecurringTransaction,
  Transaction,
} from '@suzanne/shared';
import { useTranslation } from 'react-i18next';
import { formatMonth, formatMonthLong, money as moneyFmt } from '../lib/format';
import { localeTag } from '../i18n';
import { useChartTheme } from '../lib/chartTheme';
import { CADENCE_META, cadenceAmount, cadenceOf, cadenceTotals } from '../lib/subscriptions';
import { DashboardSection } from '../components/DashboardSection';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';
import { SummaryCard } from '../components/SummaryCard';
import { TransactionList } from '../components/TransactionList';

// La Vue générale ne couvre que le mois sélectionné. Chaque donnée transverse
// (budgets, factures, patrimoine, abonnements) n'apparaît qu'en résumé via une
// SummaryCard pointant vers sa page de référence — c'est là qu'on agit.
export function Dashboard({ summary, transactions, budgets, recurring, billsStatus, reportCurrency, categoryById, accountById }: {
  summary: DashboardSummary | null;
  transactions: Transaction[];
  budgets: Budget[];
  recurring: RecurringTransaction[];
  billsStatus: BillsStatusSummary | null;
  reportCurrency: string;
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
}) {
  const { t } = useTranslation();
  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const chartTheme = useChartTheme();
  const expenseColor = chartTheme.expense;
  const navigate = useNavigate();
  // Drill-down : une part de donut ou une ligne de catégorie mène aux
  // transactions du mois filtrées sur cette catégorie.
  const openCategory = (categoryId: number | null | undefined) => {
    if (categoryId != null) navigate(`/transactions?category=${categoryId}`);
  };

  const monthRows = (summary?.monthly_cashflow ?? []).map((row) => ({ ...row, label: formatMonth(row.month) }));
  const categoryRows = summary?.expenses_by_category ?? [];
  const savingRate = summary && summary.income > 0 ? Math.round((summary.net / summary.income) * 100) : 0;
  const recurringRate = (accountId: number | null) => {
    const accountCurrency = (accountId != null ? accountById.get(accountId)?.currency : null) ?? 'EUR';
    return (summary?.exchange_rates ?? {})[accountCurrency] ?? 1;
  };
  // Active subscriptions bucketed by cadence — never smeared across months, so a
  // yearly charge stays yearly. Same logic as the Récurrents and Santé pages.
  const activeExpenseRecurring = recurring.filter((r) => r.active && r.type === 'expense');
  const subTotals = cadenceTotals(activeExpenseRecurring, recurringRate);
  const topRecurring = activeExpenseRecurring
    .map((r) => ({ r, unit: CADENCE_META[cadenceOf(r)].unit, report: cadenceAmount(r) * recurringRate(r.account_id) }))
    .sort((a, b) => b.report - a.report)
    .slice(0, 3);
  const transactionCount = transactions.length;
  const expenseTransactions = transactions.filter((t) => t.type === 'expense');
  const averageExpense = expenseTransactions.length > 0
    ? expenseTransactions.reduce((sum, t) => sum + t.amount, 0) / expenseTransactions.length
    : 0;
  const budgetLimit = budgets.reduce((sum, b) => sum + b.amount_limit, 0);
  const budgetUsed = summary?.expenses ?? 0;
  const budgetPct = budgetLimit > 0 ? Math.min(100, (budgetUsed / budgetLimit) * 100) : 0;

  // Budgets en alerte : catégories à >80% de leur plafond, triées par % décroissant.
  // Pour le mois courant on extrapole linéairement la date de dépassement à
  // partir du rythme de dépense observé depuis le début du mois.
  const budgetAlerts = (() => {
    if (budgets.length === 0) return [];
    const spentByCategory = new Map<number, number>();
    for (const row of categoryRows) {
      if (row.category_id != null) spentByCategory.set(row.category_id, row.amount);
    }
    const now = new Date();
    const selectedMonth = summary?.month ?? '';
    const isCurrentMonth = selectedMonth === now.toISOString().slice(0, 10).slice(0, 7);
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = Number(yearStr);
    const monthIdx = Number(monthStr) - 1;
    const daysInSelectedMonth = year && monthStr ? new Date(year, monthIdx + 1, 0).getDate() : 30;
    const dayOfMonth = isCurrentMonth ? now.getDate() : daysInSelectedMonth;

    return budgets
      .map((b) => {
        const spent = spentByCategory.get(b.category_id) ?? 0;
        const pct = b.amount_limit > 0 ? (spent / b.amount_limit) * 100 : 0;
        const category = categoryById.get(b.category_id);
        // Projection de dépassement (mois courant, pas encore dépassé).
        let forecast: string | null = null;
        if (isCurrentMonth && pct < 100 && spent > 0 && dayOfMonth > 0) {
          const dailyRate = spent / dayOfMonth;
          const daysToLimit = (b.amount_limit - spent) / dailyRate;
          const overshootDay = dayOfMonth + Math.ceil(daysToLimit);
          if (overshootDay <= daysInSelectedMonth) {
            const date = new Date(Date.UTC(year, monthIdx, overshootDay));
            forecast = t('dépassement prévu le {{date}}', { date: `${date.toISOString().slice(8, 10)}/${monthStr}` });
          }
        }
        return { id: b.id, category_id: b.category_id, name: category?.name ?? t('Catégorie'), color: category?.color ?? '#94a3b8', spent, limit: b.amount_limit, pct, forecast };
      })
      .filter((row) => row.pct >= 80)
      .sort((a, b) => b.pct - a.pct);
  })();
  const visibleBudgetAlerts = budgetAlerts.slice(0, 3);
  const hiddenBudgetAlerts = budgetAlerts.length - visibleBudgetAlerts.length;

  const topExpenses = transactions
    .filter((t) => t.type === 'expense')
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Prochaines factures du mois pas encore réglées (en retard d'abord).
  const upcomingBills = (billsStatus?.bills ?? [])
    .filter((entry) => entry.due && (entry.status === 'pending' || entry.status === 'late'))
    .sort((a, b) => (a.expected_date ?? '').localeCompare(b.expected_date ?? ''))
    .slice(0, 3);

  const categoryHasData = categoryRows.length > 0;
  const netWorth = summary?.net_worth ?? summary?.balance ?? null;
  const netMonthly = summary?.net ?? null;
  const monthLabel = summary?.month ? formatMonthLong(summary.month) : t('Mois sélectionné');

  // En-tête « produit » façon Binance : valeur nette en gros chiffre + sparkline
  // de la trajectoire cumulée (cumulative_net) déjà présente dans la série 12 mois.
  const sparkData = monthRows.filter((row) => Number.isFinite(row.cumulative_net));
  const sparkTrendUp = sparkData.length > 1
    ? (sparkData[sparkData.length - 1]!.cumulative_net >= sparkData[0]!.cumulative_net)
    : true;
  const sparkColor = sparkTrendUp ? chartTheme.income : chartTheme.expense;
  const heroValue = netWorth ?? (sparkData.length > 0 ? sparkData[sparkData.length - 1]!.cumulative_net : 0);

  // Comparaison N vs N-1 : 100% côté front à partir des 12 mois déjà présents
  // dans summary.monthly_cashflow. La ligne du mois précédent est celle juste
  // avant le mois sélectionné dans la série.
  const prevMonthRow = (() => {
    const idx = monthRows.findIndex((row) => row.month === summary?.month);
    return idx > 0 ? monthRows[idx - 1] : null;
  })();
  const prevSavingRate = prevMonthRow && prevMonthRow.income > 0
    ? Math.round((prevMonthRow.net / prevMonthRow.income) * 100)
    : null;

  // Petit libellé de variation coloré (vert = évolution favorable). `goodWhen`
  // dit quel sens est positif : 'up' pour revenus/net, 'down' pour dépenses.
  const moneyDelta = (current: number, previous: number | null | undefined, goodWhen: 'up' | 'down') => {
    if (previous == null || !prevMonthRow) return null;
    const diff = current - previous;
    if (Math.abs(previous) < 0.005 && Math.abs(diff) < 0.005) return null;
    const pct = Math.abs(previous) >= 0.005 ? Math.round((diff / Math.abs(previous)) * 100) : null;
    const arrow = diff === 0 ? '→' : diff > 0 ? '↑' : '↓';
    const tone = diff === 0 ? '' : (diff > 0) === (goodWhen === 'up') ? 'income' : 'expense';
    const pctText = pct == null ? '' : `${Math.abs(pct)}% `;
    return <span className={tone}>{arrow} {pctText}{t('vs')} {formatMonth(prevMonthRow.month)} ({money(previous)})</span>;
  };
  const savingRateDelta = (() => {
    if (prevSavingRate == null || !prevMonthRow) return null;
    const diff = savingRate - prevSavingRate;
    const arrow = diff === 0 ? '→' : diff > 0 ? '↑' : '↓';
    const tone = diff === 0 ? '' : diff > 0 ? 'income' : 'expense';
    return <span className={tone}>{arrow} {Math.abs(diff)} {t('pts vs')} {formatMonth(prevMonthRow.month)} ({prevSavingRate}%)</span>;
  })();

  return (
    <DashboardSection title={monthLabel} subtitle={t('Change le mois via le sélecteur en haut à droite')}>
      <section className="balance-hero">
        <div className="balance-hero-main">
          <span className="balance-hero-label">{t('Valeur nette')}</span>
          <strong className="balance-hero-value">{money(heroValue)}</strong>
          {moneyDelta(netMonthly ?? 0, prevMonthRow?.net, 'up') && (
            <span className="balance-hero-delta">{t('Net du mois')}&nbsp;: {moneyDelta(netMonthly ?? 0, prevMonthRow?.net, 'up')}</span>
          )}
        </div>
        {sparkData.length > 1 && (
          <div className="balance-hero-spark">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkColor} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  formatter={(value) => money(Number(value))}
                  labelFormatter={(label) => String(label)}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative_net"
                  name={t('Cumul')}
                  stroke={sparkColor}
                  strokeWidth={2}
                  fill="url(#sparkFill)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="stats">
        <Stat icon={<ArrowUpCircle />} label={t('Revenus')} value={money(summary?.income ?? 0)} positive delta={moneyDelta(summary?.income ?? 0, prevMonthRow?.income, 'up')} to="/transactions?type=income" />
        <Stat icon={<ArrowDownCircle />} label={t('Dépenses')} value={money(summary?.expenses ?? 0)} negative delta={moneyDelta(summary?.expenses ?? 0, prevMonthRow?.expenses, 'down')} to="/transactions?type=expense" />
        <Stat icon={<Euro />} label={t('Net mensuel')} value={money(netMonthly ?? 0)} signed={netMonthly} delta={moneyDelta(netMonthly ?? 0, prevMonthRow?.net, 'up')} />
        <Stat icon={<BarChart3 />} label={t('Taux d\'épargne')} value={`${savingRate}%`} delta={savingRateDelta} />
        <Stat icon={<CreditCard />} label={t('Transactions')} value={String(transactionCount)} to="/transactions" />
        <Stat icon={<Banknote />} label={t('Dépense moyenne')} value={money(averageExpense)} />
      </section>

      <section className="charts-grid">
        <Panel title={t('Répartition des dépenses du mois')}>
          <div className="chart-split">
            <div className="donut-area">
              {categoryHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryRows}
                      dataKey="amount"
                      nameKey="name"
                      innerRadius="58%"
                      outerRadius="86%"
                      paddingAngle={2}
                      isAnimationActive={false}
                      style={{ cursor: 'pointer' }}
                      onClick={(entry) => openCategory((entry as { payload?: { category_id?: number | null } })?.payload?.category_id)}
                    >
                      {categoryRows.map((row) => <Cell key={row.category_id ?? row.name} fill={row.color} />)}
                    </Pie>
                    <Tooltip formatter={(value) => money(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message={t('Aucune dépense ce mois-ci.')} />
              )}
            </div>
            <div className="category-list compact">
              {categoryRows.map((row) => row.category_id != null ? (
                <Link className="category-row category-link" key={row.category_id} to={`/transactions?category=${row.category_id}`}>
                  <span className="dot" style={{ background: row.color }} />
                  <span title={row.name}>{row.name}</span>
                  <strong>{money(row.amount)}</strong>
                </Link>
              ) : (
                <div className="category-row" key="none">
                  <span className="dot" style={{ background: row.color }} />
                  <span title={row.name}>{row.name}</span>
                  <strong>{money(row.amount)}</strong>
                </div>
              ))}
              {!categoryHasData && <p className="empty">{t('Aucune dépense ce mois-ci.')}</p>}
            </div>
          </div>
        </Panel>

        <SummaryCard title={t('Budgets')} to="/budgets">
          <div className="dashboard-metric">
            <div>
              <span>{t('Dépenses suivies')}</span>
              <strong>{money(budgetUsed)}</strong>
            </div>
            <div>
              <span>{t('Limites posées')}</span>
              <strong>{budgetLimit > 0 ? money(budgetLimit) : t('Aucun budget')}</strong>
            </div>
          </div>
          <div className="bar big"><span style={{ width: `${budgetPct}%`, background: budgetPct >= 100 ? 'var(--expense)' : 'var(--accent)' }} /></div>
          <p className="panel-note">{budgetLimit > 0 ? t('{{pct}} % consommé', { pct: Math.round(budgetPct) }) : t('Ajoute des budgets pour suivre la consommation du mois.')}</p>
          {visibleBudgetAlerts.length > 0 && (
            <div className="category-list compact">
              {visibleBudgetAlerts.map((row) => (
                <button
                  type="button"
                  className="category-row budget-alert-row category-link"
                  key={row.id}
                  title={t('Voir les transactions de cette catégorie')}
                  onClick={() => openCategory(row.category_id)}
                >
                  <span className="dot inline" style={{ background: row.color }} />
                  <div className="budget-alert-info">
                    <span className="budget-alert-name" title={row.name}>{row.name}</span>
                    <span className={`budget-alert-note ${row.pct >= 100 ? 'over' : ''}`}>
                      {money(row.spent)} / {money(row.limit)}
                      {row.pct >= 100
                        ? ` · ${t('dépassé de {{amount}}', { amount: money(row.spent - row.limit) })}`
                        : row.forecast ? ` · ${row.forecast}` : ''}
                    </span>
                  </div>
                  <strong className={row.pct >= 100 ? 'expense' : undefined}>{Math.round(row.pct)} %</strong>
                </button>
              ))}
              {hiddenBudgetAlerts > 0 && (
                <p className="panel-note">{t(hiddenBudgetAlerts > 1 ? '+{{n}} autres budgets en alerte' : '+{{n}} autre budget en alerte', { n: hiddenBudgetAlerts })}</p>
              )}
            </div>
          )}
        </SummaryCard>
      </section>

      <section className="charts-grid">
        <SummaryCard title={t('Plus grosses dépenses du mois')} to="/transactions">
          <TransactionList
            transactions={topExpenses}
            categoryById={categoryById}
            accountById={accountById}
            onPick={(t) => navigate(`/transactions?tx=${t.id}`)}
          />
        </SummaryCard>

        <SummaryCard title={t('Factures du mois')} to="/bills">
          {billsStatus && billsStatus.due_count > 0 ? (
            <>
              <div className="dashboard-metric">
                <div>
                  <span>{t('Payées')}</span>
                  <strong>{billsStatus.paid_count} / {billsStatus.due_count}</strong>
                </div>
                <div>
                  <span>{t('Payé / attendu')}</span>
                  <strong>{moneyFmt(billsStatus.paid_total)} / {moneyFmt(billsStatus.expected_total)}</strong>
                </div>
              </div>
              {upcomingBills.length > 0 ? (
                <div className="category-list compact">
                  {upcomingBills.map((entry) => {
                    const currency = entry.bill.account_id != null ? accountById.get(entry.bill.account_id)?.currency ?? 'EUR' : 'EUR';
                    const mid = (entry.bill.amount_min + entry.bill.amount_max) / 2;
                    return (
                      <div className="category-row" key={entry.bill.id}>
                        <span className="dot" style={{ background: entry.status === 'late' ? 'var(--expense)' : 'var(--muted)' }} />
                        <span title={entry.bill.name}>
                          {entry.bill.name}
                          {entry.expected_date ? ` · ${new Date(entry.expected_date).toLocaleDateString(localeTag(), { day: '2-digit', month: '2-digit' })}` : ''}
                          {entry.status === 'late' ? ` · ${t('en retard')}` : ''}
                        </span>
                        <strong className={entry.status === 'late' ? 'expense' : undefined}>~{moneyFmt(mid, currency)}</strong>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="panel-note">{t('Toutes les factures attendues du mois sont réglées.')}</p>
              )}
            </>
          ) : (
            <p className="empty">{t('Aucune facture attendue ce mois-ci.')}</p>
          )}
        </SummaryCard>
      </section>

      <section className="charts-grid">
        <SummaryCard title={t('Patrimoine')} to="/wealth">
          <div className="dashboard-metric">
            <div>
              <span>{t('Patrimoine net')}</span>
              <strong className={netWorth != null && netWorth < 0 ? 'expense' : 'income'}>{money(netWorth ?? 0)}</strong>
            </div>
            <div>
              <span>{t('Actifs')}</span>
              <strong>{money(summary?.balance_assets ?? 0)}</strong>
            </div>
            <div>
              <span>{t('Passifs')}</span>
              <strong>{money(summary?.balance_liabilities ?? 0)}</strong>
            </div>
          </div>
          <p className="panel-note">{t('Évolution, répartition et alertes sur la page Patrimoine.')}</p>
        </SummaryCard>

        <SummaryCard title={t('Abonnements')} to="/recurring">
          {activeExpenseRecurring.length > 0 ? (
            <>
              <div className="dashboard-metric">
                <div>
                  <span>{t('Mensuels')}</span>
                  <strong className="expense">{money(subTotals.monthly)}<small className="cadence-unit">{t('/mois')}</small></strong>
                </div>
                {subTotals.periodic > 0 && (
                  <div>
                    <span>{t('Périodiques')}</span>
                    <strong className="expense">{money(subTotals.periodic)}<small className="cadence-unit">{t('/an')}</small></strong>
                  </div>
                )}
                {subTotals.weekly > 0 && (
                  <div>
                    <span>{t('Hebdo')}</span>
                    <strong className="expense">{money(subTotals.weekly)}<small className="cadence-unit">{t('/sem')}</small></strong>
                  </div>
                )}
              </div>
              <div className="category-list compact">
                {topRecurring.map(({ r, report, unit }) => (
                  <div className="category-row" key={r.id}>
                    <span className="dot" style={{ background: expenseColor }} />
                    <span title={r.description}>{r.description}</span>
                    <strong className="expense">-{money(report)}<small className="cadence-unit">{unit}</small></strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="empty">{t('Aucun abonnement actif.')}</p>
          )}
        </SummaryCard>
      </section>
    </DashboardSection>
  );
}
