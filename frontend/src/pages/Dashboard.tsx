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
  todayIso,
  truncate,
} from '../lib/format';
import { useChartTheme } from '../lib/chartTheme';
import { usePersistedState } from '../lib/storage';
import { CADENCE_META, cadenceAmount, cadenceOf, cadenceTotals } from '../lib/subscriptions';
import { fitDomain, symlogConstant, symlogInverse, toBase100, toSymlog, type ChartScaleMode } from '../lib/chartScale';
import { DashboardSection } from '../components/DashboardSection';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';
import { TransactionList } from '../components/TransactionList';


// 12-color palette used when the wealth chart is broken down per account.
// Repeats after 12 accounts (highly unusual for personal finance), with
// roughly evenly spaced hues so adjacent series stay distinguishable.
const ACCOUNT_PALETTE = [
  '#2563eb', '#10b981', '#7c3aed', '#f59e0b', '#dc2626', '#0ea5e9',
  '#84cc16', '#a855f7', '#f97316', '#ec4899', '#06b6d4', '#65a30d',
];

interface WealthSeriesEntry { key: string; label: string; color: string; width: number }

export function Dashboard({ userId, summary, transactions, budgets, recurring, accounts, reportCurrency, categoryById, accountById, dataVersion, onOpenUnassignedTransactions }: {
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
  onOpenUnassignedTransactions: () => void;
}) {
  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const moneyCompact = (value: number) => moneyCompactFmt(value, displayCurrency);
  const chartTheme = useChartTheme();
  const chartGrid = chartTheme.grid;
  const incomeColor = chartTheme.income;
  const expenseColor = chartTheme.expense;
  const netColor = chartTheme.net;

  const [wealthRange, setWealthRange] = usePersistedState('wealth_range', '12m');
  const [wealthGranularity, setWealthGranularity] = usePersistedState('wealth_granularity', 'month');
  // Custom range bounds (persisted), used only when wealthRange === 'custom'.
  // An empty value means "open" — from falls back to the earliest data, to to today.
  const [wealthFrom, setWealthFrom] = usePersistedState('wealth_from', '');
  const [wealthTo, setWealthTo] = usePersistedState('wealth_to', '');
  const [wealthChartMode, setWealthChartMode] = usePersistedState<'area' | 'line'>('wealth_chart_mode', 'area');
  const [wealthViewMode, setWealthViewMode] = usePersistedState<'group' | 'account'>('wealth_view_mode', 'account');
  const [wealthScaleMode, setWealthScaleMode] = usePersistedState<ChartScaleMode>('wealth_scale_mode', 'linear');
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
    const from = wealthRange === 'custom' ? wealthFrom : undefined;
    const to = wealthRange === 'custom' ? wealthTo : undefined;
    api.wealthHistory(userId, wealthRange, wealthGranularity, reportCurrency, from, to)
      .then((rows) => { if (!cancelled) setWealthHistory(rows); })
      .catch(() => { if (!cancelled) setWealthHistory([]); })
      .finally(() => { if (!cancelled) setWealthLoading(false); });
    return () => { cancelled = true; };
  }, [userId, wealthRange, wealthGranularity, reportCurrency, wealthFrom, wealthTo, dataVersion]);

  // Series configuration depends on the active view mode. In account mode the
  // list is dynamic (one entry per account) so we compute it from `accounts`.
  const wealthSeriesConfig: WealthSeriesEntry[] = useMemo(() => {
    if (wealthViewMode === 'account') {
      return [
        { key: 'net_worth', label: 'Total', color: chartTheme.total, width: 3 },
        ...accounts.map((account, idx) => ({
          key: `account_${account.id}`,
          label: account.name,
          color: ACCOUNT_PALETTE[idx % ACCOUNT_PALETTE.length]!,
          width: 2,
        })),
      ];
    }
    return [
      { key: 'net_worth', label: 'Total', color: chartTheme.total, width: 3 },
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
      // Activate every account by default. Restricting to non-zero balances
      // hid every account when summary arrived after accounts on first load,
      // so the user only saw the Total line. Users with many accounts can
      // uncheck the noisy ones — the preference is persisted.
      const defaults: Record<string, boolean> = { net_worth: true };
      for (const account of accounts) {
        defaults[`account_${account.id}`] = true;
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
  // Merge the persisted preference on top of the default so newly-created
  // accounts (or new groups) show up enabled by default even after the user
  // has customised some toggles.
  const wealthSeries = useMemo(
    () => (wealthSeriesPref ? { ...defaultWealthSeries, ...wealthSeriesPref } : defaultWealthSeries),
    [wealthSeriesPref, defaultWealthSeries],
  );
  const toggleWealthSeries = (key: string) => {
    const next = { ...wealthSeries, [key]: !wealthSeries[key] };
    if (wealthViewMode === 'account') setWealthSeriesAccountPref(next);
    else setWealthSeriesGroupPref(next);
  };

  const monthRows = (summary?.monthly_cashflow ?? []).map((row) => {
    return { ...row, label: formatMonth(row.month), cumulativeNet: row.cumulative_net };
  });
  const yearRows = summary?.yearly_cashflow ?? [];
  const categoryRows = summary?.expenses_by_category ?? [];
  const wealthByGroup = (summary?.balance_by_group ?? []).filter((row) => Math.abs(row.signed_amount) > 0);
  const accountBalances = summary?.account_balances ?? [];
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
    .map((r) => ({ r, native: cadenceAmount(r), unit: CADENCE_META[cadenceOf(r)].unit, report: cadenceAmount(r) * recurringRate(r.account_id) }))
    .sort((a, b) => b.report - a.report)
    .slice(0, 6);
  // Lumps that don't fall every month, kept in their own units beside the
  // monthly figure rather than folded into it.
  const subExtras = [
    subTotals.periodic > 0 ? `${money(subTotals.periodic)}/an` : null,
    subTotals.weekly > 0 ? `${money(subTotals.weekly)}/sem` : null,
  ].filter(Boolean).join(' · ');
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
            forecast = `dépassement prévu le ${date.toISOString().slice(8, 10)}/${monthStr}`;
          }
        }
        return { id: b.id, name: category?.name ?? 'Catégorie', color: category?.color ?? '#94a3b8', spent, limit: b.amount_limit, pct, forecast };
      })
      .filter((row) => row.pct >= 80)
      .sort((a, b) => b.pct - a.pct);
  })();

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
  const fxDegraded = summary?.fx_degraded ?? [];
  const accountAlerts = buildAccountAlerts(
    accountBalances,
    summary?.balance_assets ?? 0,
    displayCurrency,
    summary?.unassigned_balance ?? 0,
    summary?.unassigned_count ?? 0,
    onOpenUnassignedTransactions,
  );
  // Surface stale/unavailable exchange rates first: when present, every
  // converted total on the page may be off, so it outranks account alerts.
  const alerts: typeof accountAlerts = [
    ...(fxDegraded.length > 0
      ? [{
          title: 'Taux de change indisponibles',
          detail: `Impossible de rafraîchir le taux pour ${fxDegraded.join(', ')}. Les montants convertis utilisent un taux périmé ou approché — réessaie plus tard.`,
          tone: 'warning' as const,
        }]
      : []),
    ...accountAlerts,
  ];
  // These derived series are rebuilt only when their real inputs change, not on
  // every render (e.g. toggling a checkbox no longer re-maps the whole history,
  // and the base100/symlog transform doesn't re-run on unrelated re-renders).
  const wealthChartRows = useMemo(() => wealthHistory.map((point) => {
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
  }), [wealthHistory, wealthGranularity]);
  const wealthHasData = wealthChartRows.length > 0;
  const wealthVisibleKeys = useMemo(
    () => wealthSeriesConfig.filter((s) => wealthSeries[s.key]).map((s) => s.key),
    [wealthSeriesConfig, wealthSeries],
  );
  const effectiveWealthScaleMode = wealthScaleMode;
  const wealthSymlogConstant = useMemo(() => symlogConstant(
    wealthChartRows.flatMap((row) =>
      wealthVisibleKeys.map((key) => row[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))),
  ), [wealthChartRows, wealthVisibleKeys]);
  const displayedWealthRows = useMemo(() => (
    effectiveWealthScaleMode === 'base100'
      ? toBase100(wealthChartRows, wealthVisibleKeys)
      : effectiveWealthScaleMode === 'symlog'
        ? toSymlog(wealthChartRows, wealthVisibleKeys, wealthSymlogConstant)
        : wealthChartRows
  ), [wealthChartRows, wealthVisibleKeys, effectiveWealthScaleMode, wealthSymlogConstant]);
  // Fit the Y axis to the *visible* series only, so toggling an account on/off
  // re-scales the chart instead of always anchoring at zero.
  const wealthDomain = useMemo(() => fitDomain(
    displayedWealthRows.flatMap((row) =>
      wealthVisibleKeys
        .map((key) => row[key])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
    ),
  ), [displayedWealthRows, wealthVisibleKeys]);
  const wealthTickFormatter = (value: number) =>
    effectiveWealthScaleMode === 'base100'
      ? `${Math.round(value)}`
      : effectiveWealthScaleMode === 'symlog'
        ? moneyCompact(symlogInverse(Number(value), wealthSymlogConstant))
        : moneyCompact(Number(value));
  const wealthTooltipFormatter = (value: unknown, name: unknown, item: { dataKey?: unknown; payload?: Record<string, unknown> }): [string, string] => {
    const dataKey = typeof item.dataKey === 'string' ? item.dataKey : '';
    const raw = item.payload?.[`${dataKey}__raw`];
    if (effectiveWealthScaleMode === 'base100') {
      const rawText = typeof raw === 'number' && Number.isFinite(raw) ? ` · ${money(raw)}` : '';
      return [`${Number(value).toFixed(1)}${rawText}`, String(name)];
    }
    if (effectiveWealthScaleMode === 'symlog') {
      return [typeof raw === 'number' && Number.isFinite(raw) ? money(raw) : money(symlogInverse(Number(value), wealthSymlogConstant)), String(name)];
    }
    return [money(Number(value)), String(name)];
  };
  const cashflowHasData = monthRows.some((row) => row.income !== 0 || row.expenses !== 0);
  const categoryHasData = categoryRows.length > 0;
  const accountsHasData = accountRows.length > 0;

  const netWorth = summary?.net_worth ?? summary?.balance ?? null;
  const netMonthly = summary?.net ?? null;
  const monthLabel = summary?.month ? formatMonthLong(summary.month) : 'Mois sélectionné';

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
    return <span className={tone}>{arrow} {pctText}vs {formatMonth(prevMonthRow.month)} ({money(previous)})</span>;
  };
  const savingRateDelta = (() => {
    if (prevSavingRate == null || !prevMonthRow) return null;
    const diff = savingRate - prevSavingRate;
    const arrow = diff === 0 ? '→' : diff > 0 ? '↑' : '↓';
    const tone = diff === 0 ? '' : diff > 0 ? 'income' : 'expense';
    return <span className={tone}>{arrow} {Math.abs(diff)} pts vs {formatMonth(prevMonthRow.month)} ({prevSavingRate}%)</span>;
  })();

  return (
    <>
      <DashboardSection title="Vue d'ensemble" subtitle="État actuel du patrimoine — indépendant du mois sélectionné">
        <section className="stats">
          <Stat icon={<Wallet />} label="Patrimoine net" value={money(netWorth ?? 0)} signed={netWorth} />
          <Stat icon={<ArrowUpCircle />} label="Actifs" value={money(summary?.balance_assets ?? 0)} positive />
          <Stat icon={<ArrowDownCircle />} label="Passifs" value={money(summary?.balance_liabilities ?? 0)} negative />
          <Stat icon={<Repeat />} label="Abonnements/mois" value={money(subTotals.monthly)} negative delta={subExtras || undefined} />
        </section>

        <section className="chart-full">
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
                <option value="custom">Personnalisé</option>
              </select>
              {wealthRange === 'custom' && (
                <>
                  <input
                    type="date"
                    value={wealthFrom}
                    max={wealthTo || todayIso()}
                    onChange={(e) => setWealthFrom(e.target.value)}
                    aria-label="Début de la période"
                  />
                  <span className="range-sep">→</span>
                  <input
                    type="date"
                    value={wealthTo}
                    min={wealthFrom || undefined}
                    max={todayIso()}
                    onChange={(e) => setWealthTo(e.target.value)}
                    aria-label="Fin de la période (vide = aujourd'hui)"
                  />
                </>
              )}
              <select value={wealthGranularity} onChange={(e) => setWealthGranularity(e.target.value)}>
                <option value="day">Jour</option>
                <option value="week">Semaine</option>
                <option value="month">Mois</option>
              </select>
              <select value={wealthChartMode} onChange={(e) => setWealthChartMode(e.target.value as 'area' | 'line')} aria-label="Type de graphique patrimoine">
                <option value="area">Zones</option>
                <option value="line">Lignes</option>
              </select>
              <select value={wealthScaleMode} onChange={(e) => setWealthScaleMode(e.target.value as ChartScaleMode)} aria-label="Échelle du graphique patrimoine">
                <option value="linear">Linéaire</option>
                <option value="symlog">Pseudo-log</option>
                <option value="base100">Base 100</option>
              </select>
            </div>
            {effectiveWealthScaleMode === 'symlog' && (
              <p className="panel-note">Pseudo-log : zéro et les soldes négatifs restent affichables, tandis que les gros écarts sont compressés. Le tooltip conserve le montant réel.</p>
            )}
            {effectiveWealthScaleMode === 'base100' && (
              <p className="panel-note">Base 100 : chaque série démarre à 100 depuis son premier solde non nul. Le tooltip conserve le montant réel.</p>
            )}
            <div className="series-toggles">
              {wealthSeriesConfig.map(({ key, label }) => (
                <label key={key}><input type="checkbox" checked={wealthSeries[key] ?? false} onChange={() => toggleWealthSeries(key)} /> {label}</label>
              ))}
            </div>
            <div className="chart-area">
              {wealthHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={displayedWealthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis
                      domain={wealthDomain}
                      tickFormatter={(value) => wealthTickFormatter(Number(value))}
                      tickLine={false}
                      axisLine={false}
                      width={70}
                    />
                    <Tooltip formatter={wealthTooltipFormatter} />
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
        </section>

        <section className="chart-full">
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
                  {alert.action && (
                    <button type="button" className="secondary" onClick={alert.action.onClick}>
                      {alert.action.label}
                    </button>
                  )}
                </div>
              ))}
              {alerts.length === 0 && <p className="empty">Aucune alerte sur les comptes.</p>}
            </div>
          </Panel>
        </section>
      </DashboardSection>

      <DashboardSection title={monthLabel} subtitle="Change le mois via le sélecteur en haut à droite">
        <section className="stats">
          <Stat icon={<ArrowUpCircle />} label="Revenus" value={money(summary?.income ?? 0)} positive delta={moneyDelta(summary?.income ?? 0, prevMonthRow?.income, 'up')} />
          <Stat icon={<ArrowDownCircle />} label="Dépenses" value={money(summary?.expenses ?? 0)} negative delta={moneyDelta(summary?.expenses ?? 0, prevMonthRow?.expenses, 'down')} />
          <Stat icon={<Euro />} label="Net mensuel" value={money(netMonthly ?? 0)} signed={netMonthly} delta={moneyDelta(netMonthly ?? 0, prevMonthRow?.net, 'up')} />
          <Stat icon={<BarChart3 />} label="Taux d'épargne" value={`${savingRate}%`} delta={savingRateDelta} />
          <Stat icon={<CreditCard />} label="Transactions" value={String(transactionCount)} />
          <Stat icon={<Banknote />} label="Dépense moyenne" value={money(averageExpense)} />
        </section>

        <section className="charts-grid">
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
                    <span title={row.name}>{row.name}</span>
                    <strong>{money(row.amount)}</strong>
                  </div>
                ))}
                {!categoryHasData && <p className="empty">Aucune dépense ce mois-ci.</p>}
              </div>
            </div>
          </Panel>

          {budgetAlerts.length > 0 && (
            <Panel title="Budgets en alerte">
              <div className="category-list compact">
                {budgetAlerts.map((row) => (
                  <div className="category-row budget-alert-row" key={row.id}>
                    <span className="dot inline" style={{ background: row.color }} />
                    <div className="budget-alert-info">
                      <span className="budget-alert-name" title={row.name}>{row.name}</span>
                      <span className={`budget-alert-note ${row.pct >= 100 ? 'over' : ''}`}>
                        {money(row.spent)} / {money(row.limit)}
                        {row.pct >= 100
                          ? ` · dépassé de ${money(row.spent - row.limit)}`
                          : row.forecast ? ` · ${row.forecast}` : ''}
                      </span>
                    </div>
                    <strong className={row.pct >= 100 ? 'expense' : undefined}>{Math.round(row.pct)} %</strong>
                  </div>
                ))}
              </div>
            </Panel>
          )}

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
        </section>

        <section className="charts-grid">
          <Panel title="Plus grosses dépenses du mois">
            <TransactionList transactions={topExpenses} categoryById={categoryById} accountById={accountById} />
          </Panel>
        </section>
      </DashboardSection>

      <DashboardSection title="Tendances longues" subtitle="12 derniers mois et années">
        <section className="charts-grid">
          <Panel title="Cashflow par mois (12 derniers mois)">
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
                    <Bar dataKey="expenses_signed" name="Dépenses" fill={expenseColor} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="cumulativeNet" name="Cumul net" stroke={netColor} strokeWidth={3} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Pas encore de cashflow à afficher." />
              )}
            </div>
          </Panel>
          <Panel title="Cumul net (12 derniers mois)">
            <div className="chart-area small">
              {cashflowHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartGrid} vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={70} />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Area type="monotone" dataKey="cumulativeNet" name="Cumul net" stroke={netColor} fill={chartTheme.netFill} strokeWidth={2} />
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
            {topRecurring.length > 0 ? (
              <>
                <div className="dashboard-metric">
                  <div>
                    <span>Mensuels</span>
                    <strong className="expense">{money(subTotals.monthly)}<small className="cadence-unit">/mois</small></strong>
                  </div>
                  {subTotals.periodic > 0 && (
                    <div>
                      <span>Périodiques</span>
                      <strong className="expense">{money(subTotals.periodic)}<small className="cadence-unit">/an</small></strong>
                    </div>
                  )}
                  {subTotals.weekly > 0 && (
                    <div>
                      <span>Hebdo</span>
                      <strong className="expense">{money(subTotals.weekly)}<small className="cadence-unit">/sem</small></strong>
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
              <p className="empty">Aucun abonnement actif.</p>
            )}
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
  unassignedBalance: number,
  unassignedCount: number,
  onOpenUnassignedTransactions: () => void,
): Array<{ title: string; detail: string; tone: 'info' | 'warning' | 'danger'; action?: { label: string; onClick: () => void } }> {
  const fmt = (value: number) => moneyFmt(value, currency);
  const alerts: Array<{ title: string; detail: string; tone: 'info' | 'warning' | 'danger'; action?: { label: string; onClick: () => void } }> = [];

  // Transactions without an account are silently merged into the cash bucket
  // by the backend (intentional, keeps totals coherent), but they're easy to
  // miss — surface them as a warning so the user can edit and assign one.
  if (unassignedCount > 0) {
    alerts.push({
      title: `${unassignedCount} transaction${unassignedCount > 1 ? 's' : ''} sans compte, toutes périodes`,
      detail: `${fmt(unassignedBalance)} de revenus/dépenses historiques n'ont pas de compte rattaché. Elles peuvent être catégorisées mais restent hors compte, donc elles sont ajoutées aux Liquidités.`,
      tone: 'warning',
      action: { label: 'Voir et corriger', onClick: onOpenUnassignedTransactions },
    });
  }

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
