import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
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
  type DashboardSummary,
  type WealthHistoryPoint,
} from '@suzanne/shared';
import { api } from '../lib/api';
import {
  formatMonth,
  money as moneyFmt,
  moneyCompact as moneyCompactFmt,
  todayIso,
} from '../lib/format';
import { timeAxisProps, timeTooltipLabel } from '../lib/timeAxis';
import { localeTag } from '../i18n';
import { useChartTheme } from '../lib/chartTheme';
import { usePersistedState } from '../lib/storage';
import { fitDomain, symlogConstant, symlogInverse, toBase100, toSymlog, type ChartScaleMode } from '../lib/chartScale';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';
import '../styles/pages/accounts.css';
import '../styles/pages/wealth.css';

// 12-color palette used when the wealth chart is broken down per account.
// Repeats after 12 accounts (highly unusual for personal finance), with
// roughly evenly spaced hues so adjacent series stay distinguishable.
const ACCOUNT_PALETTE = [
  '#2563eb', '#10b981', '#7c3aed', '#f59e0b', '#dc2626', '#0ea5e9',
  '#84cc16', '#a855f7', '#f97316', '#ec4899', '#06b6d4', '#65a30d',
];

interface WealthSeriesEntry { key: string; label: string; color: string; width: number }

export function Wealth({ userId, summary, accounts, reportCurrency, dataVersion, onOpenUnassignedTransactions }: {
  userId: number | null;
  summary: DashboardSummary | null;
  accounts: Account[];
  reportCurrency: string;
  // Increments after every successful App-level reload so the wealth-history
  // fetch (which would otherwise miss snapshot/transaction changes) re-runs.
  dataVersion: number;
  onOpenUnassignedTransactions: () => void;
}) {
  const { t } = useTranslation();
  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const moneyCompact = (value: number) => moneyCompactFmt(value, displayCurrency);
  const chartTheme = useChartTheme();
  const chartGrid = chartTheme.grid;

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
        { key: 'net_worth', label: t('patrimoine.total'), color: chartTheme.total, width: 3 },
        ...accounts.map((account, idx) => ({
          key: `account_${account.id}`,
          label: account.name,
          color: ACCOUNT_PALETTE[idx % ACCOUNT_PALETTE.length]!,
          width: 2,
        })),
      ];
    }
    return [
      { key: 'net_worth', label: t('patrimoine.total'), color: chartTheme.total, width: 3 },
      { key: 'assets', label: t('commun.assets'), color: chartTheme.income, width: 2 },
      { key: 'liabilities', label: t('commun.liabilities'), color: chartTheme.expense, width: 2 },
      { key: 'cash', label: t('patrimoine.cash'), color: accountGroupColor('cash'), width: 2 },
      { key: 'regulated_savings', label: t('patrimoine.savings_accounts'), color: accountGroupColor('regulated_savings'), width: 2 },
      { key: 'investments', label: t('patrimoine.investments'), color: accountGroupColor('investments'), width: 2 },
      { key: 'crypto', label: t('patrimoine.crypto'), color: accountGroupColor('crypto'), width: 2 },
      { key: 'property', label: t('patrimoine.property'), color: accountGroupColor('property'), width: 2 },
      { key: 'business', label: t('patrimoine.business'), color: accountGroupColor('business'), width: 2 },
      { key: 'other', label: t('patrimoine.other'), color: accountGroupColor('other'), width: 2 },
    ];
    // `chartTheme` est en dépendance : sans lui, le mémo gardait les couleurs
    // de séries (Total/Actifs/Passifs) du thème précédent jusqu'au rechargement.
  }, [wealthViewMode, accounts, chartTheme, t]);

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
      property: byGroupAmount('property') > 0,
      business: byGroupAmount('business') > 0,
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

  const wealthByGroup = (summary?.balance_by_group ?? []).filter((row) => Math.abs(row.signed_amount) > 0);
  const accountBalances = summary?.account_balances ?? [];
  const cashBalance = (summary?.balance_by_group ?? []).find((row) => row.group === 'cash')?.amount ?? 0;

  // Sort accounts by signed balance descending so the largest positive
  // balances sit on top and liabilities settle at the bottom. Names are
  // truncated by the tickFormatter to avoid the chart overlapping.
  const accountRows = accountBalances
    .map((account) => ({ id: account.account_id, name: account.name, value: account.signed_balance, group: account.group_label }))
    .sort((a, b) => b.value - a.value);

  const fxDegraded = summary?.fx_degraded ?? [];
  const accountAlerts = buildAccountAlerts(
    t,
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
          title: t('patrimoine.exchange_rates_unavailable'),
          detail: t('patrimoine.couldn_t_refresh_rate_for', { currencies: fxDegraded.join(', ') }),
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
        ? new Date(`${point.date}T00:00:00.000Z`).toLocaleDateString(localeTag(), { day: '2-digit', month: 'short' })
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
  const accountsHasData = accountRows.length > 0;
  const netWorth = summary?.net_worth ?? summary?.balance ?? null;

  return (
    <section className="pg-stack wl">
      <header className="acc-hero">
        <div className="acc-hero-main">
          <span className="acc-kicker">{t('patrimoine.net_worth')}</span>
          <strong className={`acc-hero-value num${(netWorth ?? 0) < 0 ? ' expense' : ''}`}>{money(netWorth ?? 0)}</strong>
          <span className="acc-hero-sub"><span>{t('patrimoine.snapshot_as_today_independent_selected')}</span></span>
        </div>
      </header>
      <div className="kpis wl-kpis">
        <div className="kpi"><span>{t('commun.assets')}</span><strong>{money(summary?.balance_assets ?? 0)}</strong></div>
        <div className="kpi"><span>{t('commun.liabilities')}</span><strong className={(summary?.balance_liabilities ?? 0) > 0 ? 'expense' : ''}>{money(summary?.balance_liabilities ?? 0)}</strong></div>
        <div className="kpi"><span>{t('patrimoine.cash')}</span><strong>{money(cashBalance)}</strong></div>
        <div className="kpi"><span>{t('patrimoine.accounts')}</span><strong>{accountRows.length}</strong></div>
      </div>

      <section className="chart-full">
        <Panel title={t('patrimoine.net_worth_over_time')}>
          <div className="panel-toolbar wl-toolbar">
            <select value={wealthRange} onChange={(e) => setWealthRange(e.target.value)}>
              <option value="1m">{t('patrimoine.1_month')}</option>
              <option value="6m">{t('patrimoine.6_months')}</option>
              <option value="12m">{t('patrimoine.12_months')}</option>
              <option value="ytd">{t('patrimoine.ytd')}</option>
              <option value="all">{t('patrimoine.all')}</option>
              <option value="custom">{t('patrimoine.custom')}</option>
            </select>
            {wealthRange === 'custom' && (
              <>
                <input
                  type="date"
                  value={wealthFrom}
                  max={wealthTo || todayIso()}
                  onChange={(e) => setWealthFrom(e.target.value)}
                  aria-label={t('patrimoine.start_range')}
                />
                <span className="range-sep">→</span>
                <input
                  type="date"
                  value={wealthTo}
                  min={wealthFrom || undefined}
                  max={todayIso()}
                  onChange={(e) => setWealthTo(e.target.value)}
                  aria-label={t('patrimoine.end_range_empty_today')}
                />
              </>
            )}
            <select value={wealthGranularity} onChange={(e) => setWealthGranularity(e.target.value)}>
              <option value="day">{t('patrimoine.day')}</option>
              <option value="week">{t('patrimoine.week')}</option>
              <option value="month">{t('patrimoine.month')}</option>
            </select>
            <select value={wealthViewMode} onChange={(e) => setWealthViewMode(e.target.value as 'group' | 'account')} aria-label={t('patrimoine.series_breakdown')}>
              <option value="account">{t('commun.by_account')}</option>
              <option value="group">{t('patrimoine.by_group')}</option>
            </select>
            <select value={wealthChartMode} onChange={(e) => setWealthChartMode(e.target.value as 'area' | 'line')} aria-label={t('patrimoine.net_worth_chart_type')}>
              <option value="area">{t('patrimoine.areas')}</option>
              <option value="line">{t('patrimoine.lines')}</option>
            </select>
            <select value={wealthScaleMode} onChange={(e) => setWealthScaleMode(e.target.value as ChartScaleMode)} aria-label={t('patrimoine.net_worth_chart_scale')}>
              <option value="linear">{t('patrimoine.linear')}</option>
              <option value="symlog">{t('patrimoine.pseudo_log')}</option>
              <option value="base100">{t('patrimoine.base_100')}</option>
            </select>
          </div>
          {effectiveWealthScaleMode === 'symlog' && (
            <p className="panel-note">{t('patrimoine.pseudo_log_zero_and_negative')}</p>
          )}
          {effectiveWealthScaleMode === 'base100' && (
            <p className="panel-note">{t('patrimoine.base_100_each_series_starts')}</p>
          )}
          <div className="series-toggles wl-toggles">
            {wealthSeriesConfig.map(({ key, label }) => (
              <label key={key}><input type="checkbox" checked={wealthSeries[key] ?? false} onChange={() => toggleWealthSeries(key)} /> {label}</label>
            ))}
          </div>
          <div className="chart-area">
            {wealthHasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={displayedWealthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGrid} vertical={false} />
                  <XAxis dataKey="date" {...timeAxisProps(displayedWealthRows.map((r) => String(r.date)), chartTheme.tick, wealthGranularity === 'day' || wealthGranularity === 'week' ? 'day' : 'month')} minTickGap={24} />
                  <YAxis
                    domain={wealthDomain}
                    tickFormatter={(value) => wealthTickFormatter(Number(value))}
                    tickLine={false}
                    axisLine={false}
                    width={70}
                  />
                  <Tooltip formatter={wealthTooltipFormatter} labelFormatter={timeTooltipLabel(wealthGranularity === 'day' || wealthGranularity === 'week' ? 'day' : 'month')} />
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
                          isAnimationActive={false}
                        />
                      );
                    }
                    return <Line key={key} type="monotone" dataKey={key} name={label} stroke={color} strokeWidth={width} dot={false} isAnimationActive={false} />;
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message={wealthLoading ? t('patrimoine.loading_history') : t('patrimoine.not_enough_history_yet_to')} />
            )}
          </div>
        </Panel>
      </section>

      <section className="chart-full">
        <Panel title={t('patrimoine.net_worth_breakdown')}>
          <div className="chart-split">
            <div className="donut-area">
              {wealthByGroup.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={wealthByGroup} dataKey="amount" nameKey="label" innerRadius="58%" outerRadius="86%" paddingAngle={2} isAnimationActive={false}>
                      {wealthByGroup.map((row) => <Cell key={row.group} fill={accountGroupColor(row.group)} />)}
                    </Pie>
                    <Tooltip formatter={(value) => money(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message={t('patrimoine.no_balance_to_break_down')} />
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
              {wealthByGroup.length === 0 && <p className="empty">{t('patrimoine.no_balance_to_break_down')}</p>}
            </div>
          </div>
        </Panel>
      </section>

      <section className="charts-grid">
        <Panel title={t('patrimoine.balances_by_account')}>
          {accountsHasData ? (
            <ul className="wl-accounts">
              {accountRows.map((row) => (
                <li key={row.id}>
                  <Link to={`/accounts/${row.id}`}>
                    <span className="wl-acc-name">{row.name}<small>{row.group}</small></span>
                    <span className={`num${row.value < 0 ? ' expense' : ''}`}>{money(row.value)}</span>
                    <span className="wl-acc-bar"><i style={{ width: `${(Math.abs(row.value) / Math.max(1, ...accountRows.map((r) => Math.abs(r.value)))) * 100}%` }} className={row.value < 0 ? 'neg' : ''} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyChart message={t('patrimoine.no_accounts_to_display')} />
          )}
        </Panel>
        <Panel title={t('patrimoine.account_alerts')}>
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
            {alerts.length === 0 && <p className="empty">{t('patrimoine.no_account_alerts')}</p>}
          </div>
        </Panel>
      </section>
    </section>
  );
}

function buildAccountAlerts(
  t: TFunction,
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
      title: t(unassignedCount > 1 ? 'patrimoine.count_transactions_without_account_all' : 'patrimoine.count_transaction_without_account_all', { count: unassignedCount }),
      detail: t('patrimoine.amount_historical_income_expense_has', { amount: fmt(unassignedBalance) }),
      tone: 'warning',
      action: { label: t('patrimoine.view_and_fix'), onClick: onOpenUnassignedTransactions },
    });
  }

  const checking = accountBalances
    .filter((a) => a.type === 'checking')
    .reduce((sum, a) => sum + a.balance, 0);
  if (checking > 3000) {
    alerts.push({
      title: t('patrimoine.high_cash_on_checking_account'),
      detail: t('patrimoine.amount_is_sitting_on_checking', { amount: fmt(checking) }),
      tone: 'info',
    });
  }

  for (const account of accountBalances) {
    const ceiling = LIVRET_CEILINGS[account.type as AccountType];
    if (!ceiling) continue;
    const pct = account.balance / ceiling;
    if (pct >= 0.9) {
      alerts.push({
        title: t('patrimoine.name_near_its_ceiling', { name: account.name }),
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
      title: t('patrimoine.high_crypto_share_net_worth'),
      detail: t('patrimoine.pct_assets_are_in_crypto', { pct: Math.round((crypto / totalAssets) * 100) }),
      tone: 'warning',
    });
  }

  const liabilities = accountBalances
    .filter((a) => a.is_liability)
    .reduce((sum, a) => sum + a.balance, 0);
  if (liabilities > 0) {
    alerts.push({
      title: t('patrimoine.liabilities_to_watch'),
      detail: t('patrimoine.amount_credit_loans_is_included', { amount: fmt(liabilities) }),
      tone: 'info',
    });
  }
  return alerts;
}
