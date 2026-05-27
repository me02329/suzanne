import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  Banknote,
  CreditCard,
  Euro,
  Repeat,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  LIVRET_CEILINGS,
  accountGroupColor,
  type Account,
  type AccountType,
  type Budget,
  type Category,
  type DashboardSummary,
  type RecurringTransaction,
  type Transaction,
  type WealthHistoryPoint,
} from '@suzanne-lite/shared';
import { api } from '../lib/api';
import {
  formatMonth,
  formatMonthLong,
  money as moneyFmt,
  moneyCompact as moneyCompactFmt,
  truncate,
} from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { DashboardSection } from '../components/DashboardSection';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';
import { TransactionList } from '../components/TransactionList';

const chartGrid = '#e8edf5';
const incomeColor = '#15803d';
const expenseColor = '#dc2626';
const netColor = '#2563eb';

// 12-color palette used when the wealth chart is broken down per account.
// Repeats after 12 accounts (highly unusual for personal finance), with
// roughly evenly spaced hues so adjacent series stay distinguishable.
const ACCOUNT_PALETTE = [
  '#2563eb', '#10b981', '#7c3aed', '#f59e0b', '#dc2626', '#0ea5e9',
  '#84cc16', '#a855f7', '#f97316', '#ec4899', '#06b6d4', '#65a30d',
];

interface WealthSeriesEntry { key: string; label: string; color: string; width: number }

export function Dashboard({ userId, summary, transactions, budgets, recurring, accounts, reportCurrency, categoryById, accountById, dataVersion }: {
  userId: number | null;
  summary: DashboardSummary | null;
  transactions: Transaction[];
  budgets: Budget[];
  recurring: RecurringTransaction[];
  accounts: Account[];
  reportCurrency: string;
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  // Increments after every successful App-level reload so the wealth-history
  // fetch (which would otherwise miss snapshot/transaction changes) re-runs.
  dataVersion: number;
}) {
  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const moneyCompact = (value: number) => moneyCompactFmt(value, displayCurrency);

  const [wealthRange, setWealthRange] = usePersistedState('wealth_range', '12m');
  const [wealthGranularity, setWealthGranularity] = usePersistedState('wealth_granularity', 'month');
  const [wealthChartMode, setWealthChartMode] = usePersistedState<'area' | 'line'>('wealth_chart_mode', 'area');
  const [wealthViewMode, setWealthViewMode] = usePersistedState<'group' | 'account'>('wealth_view_mode', 'account');
  // Two separate persisted preferences so toggling Group ↔ Account preserves
  // each side's checkbox state independently.
  const [wealthSeriesGroupPref, setWealthSeriesGroupPref] = usePersistedState<Record<string, boolean> | null>('wealth_series_groups', null);
  const [wealthSeriesAccountPref, setWealthSeriesAccountPref] = usePersistedState<Record<string, boolean> | null>('wealth_series_accounts', null);
  const [wealthHistory, setWealthHistory] = useState<WealthHistoryPoint[]>([]);
  const [wealthLoading, setWealthLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setWealthLoading(true);
    api.wealthHistory(userId, wealthRange, wealthGranularity, reportCurrency)
      .then((rows) => { if (!cancelled) setWealthHistory(rows); })
      .catch(() => { if (!cancelled) setWealthHistory([]); })
      .finally(() => { if (!cancelled) setWealthLoading(false); });
    return () => { cancelled = true; };
  }, [userId, wealthRange, wealthGranularity, reportCurrency, dataVersion]);

  // Series configuration depends on the active view mode. In account mode the
  // list is dynamic (one entry per account) so we compute it from `accounts`.
  const wealthSeriesConfig: WealthSeriesEntry[] = useMemo(() => {
    if (wealthViewMode === 'account') {
      return [
        { key: 'net_worth', label: 'Total', color: '#111827', width: 3 },
        ...accounts.map((account, idx) => ({
          key: `account_${account.id}`,
          label: account.name,
          color: ACCOUNT_PALETTE[idx % ACCOUNT_PALETTE.length]!,
          width: 2,
        })),
      ];
    }
    return [
      { key: 'net_worth', label: 'Total', color: '#111827', width: 3 },
      { key: 'assets', label: 'Actifs', color: '#16a34a', width: 2 },
      { key: 'liabilities', label: 'Passifs', color: '#dc2626', width: 2 },
      { key: 'cash', label: 'Liquidités', color: accountGroupColor('cash'), width: 2 },
      { key: 'regulated_savings', label: 'Livrets', color: accountGroupColor('regulated_savings'), width: 2 },
      { key: 'investments', label: 'Investissements', color: accountGroupColor('investments'), width: 2 },
      { key: 'crypto', label: 'Crypto', color: accountGroupColor('crypto'), width: 2 },
      { key: 'other', label: 'Autres', color: accountGroupColor('other'), width: 2 },
    ];
  }, [wealthViewMode, accounts]);

  const defaultWealthSeries = useMemo<Record<string, boolean>>(() => {
    if (wealthViewMode === 'account') {
      const balances = new Map((summary?.account_balances ?? []).map((a) => [a.account_id, a.balance]));
      const defaults: Record<string, boolean> = { net_worth: true };
      // Activate every account by default; if the user has many they can
      // uncheck the ones they don't care about and the preference is persisted.
      for (const account of accounts) {
        defaults[`account_${account.id}`] = (balances.get(account.id) ?? 0) !== 0;
      }
      return defaults;
    }
    const byGroupAmount = (group: string) =>
      (summary?.balance_by_group ?? []).find((row) => row.group === group)?.amount ?? 0;
    return {
      net_worth: true,
      assets: (summary?.balance_assets ?? 0) > 0,
      liabilities: (summary?.balance_liabilities ?? 0) > 0,
      cash: byGroupAmount('cash') > 0,
      regulated_savings: byGroupAmount('regulated_savings') > 0,
      investments: byGroupAmount('investments') > 0,
      crypto: byGroupAmount('crypto') > 0,
      other: byGroupAmount('other') > 0,
    };
  }, [wealthViewMode, summary, accounts]);

  const wealthSeriesPref = wealthViewMode === 'account' ? wealthSeriesAccountPref : wealthSeriesGroupPref;
  const wealthSeries = wealthSeriesPref ?? defaultWealthSeries;
  const toggleWealthSeries = (key: string) => {
    const next = { ...wealthSeries, [key]: !wealthSeries[key] };
    if (wealthViewMode === 'account') setWealthSeriesAccountPref(next);
    else setWealthSeriesGroupPref(next);
  };

  let cumulativeNet = 0;
  const monthRows = (summary?.monthly_cashflow ?? []).map((row) => {
    cumulativeNet += row.net;
    return { ...row, label: formatMonth(row.month), cumulativeNet };
  });
  const yearRows = summary?.yearly_cashflow ?? [];
  const categoryRows = summary?.expenses_by_category ?? [];
  const wealthByGroup = (summary?.balance_by_group ?? []).filter((row) => Math.abs(row.signed_amount) > 0);
  const accountBalances = summary?.account_balances ?? [];
  const savingRate = summary && summary.income > 0 ? Math.round((summary.net / summary.income) * 100) : 0;
  const activeRecurring = recurring.filter((r) => r.active);
  const subscriptionExpenses = activeRecurring.filter((r) => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
  const subscriptionIncomes = activeRecurring.filter((r) => r.type === 'income').reduce((sum, r) => sum + r.amount, 0);
  const transactionCount = transactions.length;
  const expenseTransactions = transactions.filter((t) => t.type === 'expense');
  const averageExpense = expenseTransactions.length > 0
    ? expenseTransactions.reduce((sum, t) => sum + t.amount, 0) / expenseTransactions.length
    : 0;
  const budgetLimit = budgets.reduce((sum, b) => sum + b.amount_limit, 0);
  const budgetUsed = summary?.expenses ?? 0;
  const budgetPct = budgetLimit > 0 ? Math.min(100, (budgetUsed / budgetLimit) * 100) : 0;

  // Sort accounts by signed balance descending so the largest positive
  // balances sit on top and liabilities settle at the bottom. Names are
  // truncated by the tickFormatter to avoid the chart overlapping.
  const accountRows = accountBalances
    .map((account) => ({ name: account.name, value: account.signed_balance, group: account.group_label }))
    .sort((a, b) => b.value - a.value);

  const topExpenses = transactions
    .filter((t) => t.type === 'expense')
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const alerts = buildAccountAlerts(accountBalances, summary?.balance_assets ?? 0, displayCurrency);
  const wealthChartRows = wealthHistory.map((point) => {
    const row: Record<string, unknown> = {
      ...point,
      label: wealthGranularity === 'day' || wealthGranularity === 'week'
        ? new Date(`${point.date}T00:00:00.000Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
        : formatMonth(point.date.slice(0, 7)),
      cash: point.by_group.cash ?? 0,
      regulated_savings: point.by_group.regulated_savings ?? 0,
      investments: point.by_group.investments ?? 0,
      crypto: point.by_group.crypto ?? 0,
      liabilities_signed: point.by_group.liabilities ?? 0,
      other: point.by_group.other ?? 0,
    };
    // Flatten by_account so recharts can read each `account_<id>` directly
    // from the row instead of going through a nested object.
    for (const [id, value] of Object.entries(point.by_account ?? {})) {
      row[`account_${id}`] = value;
    }
    return row;
  });
  const wealthHasData = wealthChartRows.length > 0;
  const cashflowHasData = monthRows.some((row) => row.income !== 0 || row.expenses !== 0);
  const categoryHasData = categoryRows.length > 0;
  const accountsHasData = accountRows.length > 0;

  const netWorth = summary?.net_worth ?? summary?.balance ?? null;
  const netMonthly = summary?.net ?? null;
  const monthLabel = summary?.month ? formatMonthLong(summary.month) : 'Mois sélectionné';

  return (
    <>
      <DashboardSection title="Vue d'ensemble" subtitle="État actuel du patrimoine — indépendant du mois sélectionné">
        <section className="stats">
          <Stat icon={<Wallet />} label="Patrimoine net" value={money(netWorth ?? 0)} signed={netWorth} />
          <Stat icon={<ArrowUpCircle />} label="Actifs" value={money(summary?.balance_assets ?? 0)} positive />
          <Stat icon={<ArrowDownCircle />} label="Passifs" value={money(summary?.balance_liabilities ?? 0)} negative />
          <Stat icon={<Repeat />} label="Abonnements/mois" value={money(subscriptionExpenses)} negative />
        </section>

        <section className="charts-grid">
          <Panel title="Évolution du patrimoine">
            <div className="panel-toolbar">
              <select value={wealthViewMode} onChange={(e) => setWealthViewMode(e.target.value as 'group' | 'account')} aria-label="Découpage des séries">
                <option value="account">Par compte</option>
                <option value="group">Par groupe</option>
              </select>
              <select value={wealthRange} onChange={(e) => setWealthRange(e.target.value)}>
                <option value="1m">1 mois</option>
                <option value="6m">6 mois</option>
                <option value="12m">12 mois</option>
                <option value="ytd">YTD</option>
                <option value="all">Tout</option>
              </select>
              <select value={wealthGranularity} onChange={(e) => setWealthGranularity(e.target.value)}>
                <option value="day">Jour</option>
                <option value="week">Semaine</option>
                <option value="month">Mois</option>
              </select>
              <select value={wealthChartMode} onChange={(e) => setWealthChartMode(e.target.value as 'area' | 'line')} aria-label="Type de graphique patrimoine">
                <option value="area">Zones</option>
                <option value="line">Lignes</option>
              </select>
            </div>
            <div className="series-toggles">
              {wealthSeriesConfig.map(({ key, label }) => (
                <label key={key}><input type="checkbox" checked={wealthSeries[key] ?? false} onChange={() => toggleWealthSeries(key)} /> {label}</label>
              ))}
            </div>
            <div className="chart-area">
              {wealthHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={wealthChartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={70} />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Legend />
                    {wealthSeriesConfig.map(({ key, label, color, width }) => {
                      if (!wealthSeries[key]) return null;
                      if (wealthChartMode === 'area') {
                        return (
                          <Area
                            key={key}
                            type="monotone"
                            dataKey={key}
                            name={label}
                            stroke={color}
                            strokeWidth={width}
                            fill={color}
                            fillOpacity={key === 'net_worth' ? 0.2 : 0.14}
                            dot={false}
                          />
                        );
                      }
                      return <Line key={key} type="monotone" dataKey={key} name={label} stroke={color} strokeWidth={width} dot={false} />;
                    })}
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message={wealthLoading ? 'Chargement de l\'historique…' : 'Pas encore assez d\'historique pour tracer cette plage.'} />
              )}
            </div>
          </Panel>

          <Panel title="Répartition du patrimoine">
            <div className="chart-split">
              <div className="donut-area">
                {wealthByGroup.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={wealthByGroup} dataKey="amount" nameKey="label" innerRadius="58%" outerRadius="86%" paddingAngle={2}>
                        {wealthByGroup.map((row) => <Cell key={row.group} fill={accountGroupColor(row.group)} />)}
                      </Pie>
                      <Tooltip formatter={(value) => money(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="Aucun solde à répartir." />
                )}
              </div>
              <div className="category-list compact">
                {wealthByGroup.map((row) => (
                  <div className="category-row" key={row.group}>
                    <span className="dot" style={{ background: accountGroupColor(row.group) }} />
                    <span>{row.label}</span>
                    <strong className={row.is_liability ? 'expense' : ''}>{row.is_liability ? '-' : ''}{money(row.amount)}</strong>
                  </div>
                ))}
                {wealthByGroup.length === 0 && <p className="empty">Aucun solde à répartir.</p>}
              </div>
            </div>
          </Panel>
        </section>

        <section className="charts-grid">
          <Panel title="Soldes par compte">
            <div className="chart-area small">
              {accountsHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={accountRows} layout="vertical" margin={{ top: 8, right: 8, left: 16, bottom: 0 }}>
                    <CartesianGrid stroke={chartGrid} horizontal={false} />
                    <XAxis type="number" tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={140}
                      tickFormatter={(value) => truncate(String(value), 18)}
                    />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Bar dataKey="value" name="Solde" fill={netColor} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Aucun compte à afficher." />
              )}
            </div>
          </Panel>
          <Panel title="Alertes comptes">
            <div className="alert-list">
              {alerts.map((alert) => (
                <div className={`account-alert ${alert.tone}`} key={alert.title}>
                  <strong>{alert.title}</strong>
                  <span>{alert.detail}</span>
                </div>
              ))}
              {alerts.length === 0 && <p className="empty">Aucune alerte sur les comptes.</p>}
            </div>
          </Panel>
        </section>
      </DashboardSection>

      <DashboardSection title={monthLabel} subtitle="Change le mois via le sélecteur en haut à droite">
        <section className="stats">
          <Stat icon={<ArrowUpCircle />} label="Revenus" value={money(summary?.income ?? 0)} positive />
          <Stat icon={<ArrowDownCircle />} label="Dépenses" value={money(summary?.expenses ?? 0)} negative />
          <Stat icon={<Euro />} label="Net mensuel" value={money(netMonthly ?? 0)} signed={netMonthly} />
          <Stat icon={<BarChart3 />} label="Taux d'épargne" value={`${savingRate}%`} />
          <Stat icon={<CreditCard />} label="Transactions" value={String(transactionCount)} />
          <Stat icon={<Banknote />} label="Dépense moyenne" value={money(averageExpense)} />
        </section>

        <section className="charts-grid">
          <Panel title="Cashflow mensuel">
            <div className="chart-area">
              {cashflowHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={70} />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Legend />
                    <Bar dataKey="income" name="Revenus" fill={incomeColor} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name="Dépenses" fill={expenseColor} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="cumulativeNet" name="Cumul net" stroke={netColor} strokeWidth={3} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Pas encore de cashflow à afficher." />
              )}
            </div>
          </Panel>

          <Panel title="Répartition des dépenses du mois">
            <div className="chart-split">
              <div className="donut-area">
                {categoryHasData ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categoryRows} dataKey="amount" nameKey="name" innerRadius="58%" outerRadius="86%" paddingAngle={2}>
                        {categoryRows.map((row) => <Cell key={row.category_id ?? row.name} fill={row.color} />)}
                      </Pie>
                      <Tooltip formatter={(value) => money(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="Aucune dépense ce mois-ci." />
                )}
              </div>
              <div className="category-list compact">
                {categoryRows.map((row) => (
                  <div className="category-row" key={row.category_id ?? 'none'}>
                    <span className="dot" style={{ background: row.color }} />
                    <span>{row.name}</span>
                    <strong>{money(row.amount)}</strong>
                  </div>
                ))}
                {!categoryHasData && <p className="empty">Aucune dépense ce mois-ci.</p>}
              </div>
            </div>
          </Panel>
        </section>

        <section className="charts-grid">
          <Panel title="Budget du mois">
            <div className="dashboard-metric">
              <div>
                <span>Dépenses suivies</span>
                <strong>{money(budgetUsed)}</strong>
              </div>
              <div>
                <span>Limites posées</span>
                <strong>{budgetLimit > 0 ? money(budgetLimit) : 'Aucun budget'}</strong>
              </div>
            </div>
            <div className="bar big"><span style={{ width: `${budgetPct}%`, background: budgetPct >= 100 ? '#dc2626' : '#2563eb' }} /></div>
            <p className="panel-note">{budgetLimit > 0 ? `${Math.round(budgetPct)} % consommé` : 'Ajoute des budgets pour suivre la consommation du mois.'}</p>
          </Panel>
          <Panel title="Plus grosses dépenses du mois">
            <TransactionList transactions={topExpenses} categoryById={categoryById} accountById={accountById} />
          </Panel>
        </section>
      </DashboardSection>

      <DashboardSection title="Tendances longues" subtitle="12 derniers mois et années">
        <section className="charts-grid">
          <Panel title="Cumul net 12 mois">
            <div className="chart-area small">
              {cashflowHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={70} />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Area type="monotone" dataKey="cumulativeNet" name="Cumul net" stroke={netColor} fill="#dbeafe" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Pas encore de cumul net à afficher." />
              )}
            </div>
          </Panel>
          <Panel title="Tendance annuelle">
            <div className="chart-area small">
              {yearRows.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={yearRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={70} />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Legend />
                    <Line type="monotone" dataKey="income" name="Revenus" stroke={incomeColor} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="expenses" name="Dépenses" stroke={expenseColor} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="net" name="Net" stroke={netColor} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Pas encore d'historique annuel." />
              )}
            </div>
          </Panel>
        </section>

        <section className="charts-grid">
          <Panel title="Abonnements actifs">
            <div className="dashboard-metric">
              <div>
                <span>Sorties mensuelles</span>
                <strong className="expense">{money(subscriptionExpenses)}</strong>
              </div>
              <div>
                <span>Entrées récurrentes</span>
                <strong className="income">{money(subscriptionIncomes)}</strong>
              </div>
            </div>
            <div className="category-list compact">
              {activeRecurring.slice(0, 6).map((r) => (
                <div className="category-row" key={r.id}>
                  <span className="dot" style={{ background: r.type === 'income' ? incomeColor : expenseColor }} />
                  <span>{r.description}</span>
                  <strong className={r.type === 'income' ? 'income' : 'expense'}>{r.type === 'income' ? '+' : '-'}{money(r.amount)}</strong>
                </div>
              ))}
              {activeRecurring.length === 0 && <p className="empty">Aucun récurrent actif.</p>}
            </div>
          </Panel>
        </section>
      </DashboardSection>
    </>
  );
}

function buildAccountAlerts(
  accountBalances: DashboardSummary['account_balances'],
  totalAssets: number,
  currency: string,
): Array<{ title: string; detail: string; tone: 'info' | 'warning' | 'danger' }> {
  const fmt = (value: number) => moneyFmt(value, currency);
  const alerts: Array<{ title: string; detail: string; tone: 'info' | 'warning' | 'danger' }> = [];
  const checking = accountBalances
    .filter((a) => a.type === 'checking')
    .reduce((sum, a) => sum + a.balance, 0);
  if (checking > 3000) {
    alerts.push({
      title: 'Cash élevé sur compte courant',
      detail: `${fmt(checking)} restent sur compte courant. Une partie pourrait être fléchée vers livret ou investissement.`,
      tone: 'info',
    });
  }

  for (const account of accountBalances) {
    const ceiling = LIVRET_CEILINGS[account.type as AccountType];
    if (!ceiling) continue;
    const pct = account.balance / ceiling;
    if (pct >= 0.9) {
      alerts.push({
        title: `${account.name} proche du plafond`,
        detail: `${fmt(account.balance)} / ${fmt(ceiling)} (${Math.round(pct * 100)} %).`,
        tone: pct >= 1 ? 'danger' : 'warning',
      });
    }
  }

  const crypto = accountBalances
    .filter((a) => a.type === 'crypto')
    .reduce((sum, a) => sum + a.balance, 0);
  if (totalAssets > 0 && crypto / totalAssets >= 0.15) {
    alerts.push({
      title: 'Crypto élevée dans le patrimoine',
      detail: `${Math.round((crypto / totalAssets) * 100)} % des actifs sont en crypto.`,
      tone: 'warning',
    });
  }

  const liabilities = accountBalances
    .filter((a) => a.is_liability)
    .reduce((sum, a) => sum + a.balance, 0);
  if (liabilities > 0) {
    alerts.push({
      title: 'Passifs à suivre',
      detail: `${fmt(liabilities)} de crédits/emprunts sont intégrés au patrimoine net.`,
      tone: 'info',
    });
  }
  return alerts;
}
