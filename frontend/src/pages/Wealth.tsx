import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowDownCircle, ArrowUpCircle, Banknote, Wallet } from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
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
  truncate,
} from '../lib/format';
import { localeTag } from '../i18n';
import { useChartTheme } from '../lib/chartTheme';
import { usePersistedState } from '../lib/storage';
import { fitDomain, symlogConstant, symlogInverse, toBase100, toSymlog, type ChartScaleMode } from '../lib/chartScale';
import { DashboardSection } from '../components/DashboardSection';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';

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
        { key: 'net_worth', label: t('Total'), color: chartTheme.total, width: 3 },
        ...accounts.map((account, idx) => ({
          key: `account_${account.id}`,
          label: account.name,
          color: ACCOUNT_PALETTE[idx % ACCOUNT_PALETTE.length]!,
          width: 2,
        })),
      ];
    }
    return [
      { key: 'net_worth', label: t('Total'), color: chartTheme.total, width: 3 },
      { key: 'assets', label: t('Actifs'), color: chartTheme.income, width: 2 },
      { key: 'liabilities', label: t('Passifs'), color: chartTheme.expense, width: 2 },
      { key: 'cash', label: t('Liquidités'), color: accountGroupColor('cash'), width: 2 },
      { key: 'regulated_savings', label: t('Livrets'), color: accountGroupColor('regulated_savings'), width: 2 },
      { key: 'investments', label: t('Investissements'), color: accountGroupColor('investments'), width: 2 },
      { key: 'crypto', label: t('Crypto'), color: accountGroupColor('crypto'), width: 2 },
      { key: 'other', label: t('Autres'), color: accountGroupColor('other'), width: 2 },
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

  const navigate = useNavigate();
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
          title: t('Taux de change indisponibles'),
          detail: t('Impossible de rafraîchir le taux pour {{currencies}}. Les montants convertis utilisent un taux périmé ou approché — réessaie plus tard.', { currencies: fxDegraded.join(', ') }),
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
    <DashboardSection title={t('État actuel')} subtitle={t('Photographie du patrimoine — indépendant du mois sélectionné')}>
      <section className="stats">
        <Stat icon={<Wallet />} label={t('Patrimoine net')} value={money(netWorth ?? 0)} signed={netWorth} />
        <Stat icon={<ArrowUpCircle />} label={t('Actifs')} value={money(summary?.balance_assets ?? 0)} positive />
        <Stat icon={<ArrowDownCircle />} label={t('Passifs')} value={money(summary?.balance_liabilities ?? 0)} negative />
        <Stat icon={<Banknote />} label={t('Liquidités')} value={money(cashBalance)} />
      </section>

      <section className="chart-full">
        <Panel title={t('Évolution du patrimoine')}>
          <div className="panel-toolbar">
            <select value={wealthRange} onChange={(e) => setWealthRange(e.target.value)}>
              <option value="1m">{t('1 mois')}</option>
              <option value="6m">{t('6 mois')}</option>
              <option value="12m">{t('12 mois')}</option>
              <option value="ytd">{t('YTD')}</option>
              <option value="all">{t('Tout')}</option>
              <option value="custom">{t('Personnalisé')}</option>
            </select>
            {wealthRange === 'custom' && (
              <>
                <input
                  type="date"
                  value={wealthFrom}
                  max={wealthTo || todayIso()}
                  onChange={(e) => setWealthFrom(e.target.value)}
                  aria-label={t('Début de la période')}
                />
                <span className="range-sep">→</span>
                <input
                  type="date"
                  value={wealthTo}
                  min={wealthFrom || undefined}
                  max={todayIso()}
                  onChange={(e) => setWealthTo(e.target.value)}
                  aria-label={t('Fin de la période (vide = aujourd\'hui)')}
                />
              </>
            )}
            <select value={wealthGranularity} onChange={(e) => setWealthGranularity(e.target.value)}>
              <option value="day">{t('Jour')}</option>
              <option value="week">{t('Semaine')}</option>
              <option value="month">{t('Mois')}</option>
            </select>
            <select value={wealthViewMode} onChange={(e) => setWealthViewMode(e.target.value as 'group' | 'account')} aria-label={t('Découpage des séries')}>
              <option value="account">{t('Par compte')}</option>
              <option value="group">{t('Par groupe')}</option>
            </select>
            <select value={wealthChartMode} onChange={(e) => setWealthChartMode(e.target.value as 'area' | 'line')} aria-label={t('Type de graphique patrimoine')}>
              <option value="area">{t('Zones')}</option>
              <option value="line">{t('Lignes')}</option>
            </select>
            <select value={wealthScaleMode} onChange={(e) => setWealthScaleMode(e.target.value as ChartScaleMode)} aria-label={t('Échelle du graphique patrimoine')}>
              <option value="linear">{t('Linéaire')}</option>
              <option value="symlog">{t('Pseudo-log')}</option>
              <option value="base100">{t('Base 100')}</option>
            </select>
          </div>
          {effectiveWealthScaleMode === 'symlog' && (
            <p className="panel-note">{t('Pseudo-log : zéro et les soldes négatifs restent affichables, tandis que les gros écarts sont compressés. Le tooltip conserve le montant réel.')}</p>
          )}
          {effectiveWealthScaleMode === 'base100' && (
            <p className="panel-note">{t('Base 100 : chaque série démarre à 100 depuis son premier solde non nul. Le tooltip conserve le montant réel.')}</p>
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
                          isAnimationActive={false}
                        />
                      );
                    }
                    return <Line key={key} type="monotone" dataKey={key} name={label} stroke={color} strokeWidth={width} dot={false} isAnimationActive={false} />;
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message={wealthLoading ? t('Chargement de l\'historique…') : t('Pas encore assez d\'historique pour tracer cette plage.')} />
            )}
          </div>
        </Panel>
      </section>

      <section className="chart-full">
        <Panel title={t('Répartition du patrimoine')}>
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
                <EmptyChart message={t('Aucun solde à répartir.')} />
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
              {wealthByGroup.length === 0 && <p className="empty">{t('Aucun solde à répartir.')}</p>}
            </div>
          </div>
        </Panel>
      </section>

      <section className="charts-grid">
        <Panel title={t('Soldes par compte')}>
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
                  <Bar
                    dataKey="value"
                    name={t('Solde')}
                    fill={netColor}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                    style={{ cursor: 'pointer' }}
                    onClick={(entry) => {
                      const id = (entry as { payload?: { id?: number } })?.payload?.id;
                      if (id != null) navigate(`/accounts/${id}`);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message={t('Aucun compte à afficher.')} />
            )}
          </div>
        </Panel>
        <Panel title={t('Alertes comptes')}>
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
            {alerts.length === 0 && <p className="empty">{t('Aucune alerte sur les comptes.')}</p>}
          </div>
        </Panel>
      </section>
    </DashboardSection>
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
      title: t(unassignedCount > 1 ? '{{count}} transactions sans compte, toutes périodes' : '{{count}} transaction sans compte, toutes périodes', { count: unassignedCount }),
      detail: t('{{amount}} de revenus/dépenses historiques n\'ont pas de compte rattaché. Elles peuvent être catégorisées mais restent hors compte, donc elles sont ajoutées aux Liquidités.', { amount: fmt(unassignedBalance) }),
      tone: 'warning',
      action: { label: t('Voir et corriger'), onClick: onOpenUnassignedTransactions },
    });
  }

  const checking = accountBalances
    .filter((a) => a.type === 'checking')
    .reduce((sum, a) => sum + a.balance, 0);
  if (checking > 3000) {
    alerts.push({
      title: t('Cash élevé sur compte courant'),
      detail: t('{{amount}} restent sur compte courant. Une partie pourrait être fléchée vers livret ou investissement.', { amount: fmt(checking) }),
      tone: 'info',
    });
  }

  for (const account of accountBalances) {
    const ceiling = LIVRET_CEILINGS[account.type as AccountType];
    if (!ceiling) continue;
    const pct = account.balance / ceiling;
    if (pct >= 0.9) {
      alerts.push({
        title: t('{{name}} proche du plafond', { name: account.name }),
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
      title: t('Crypto élevée dans le patrimoine'),
      detail: t('{{pct}} % des actifs sont en crypto.', { pct: Math.round((crypto / totalAssets) * 100) }),
      tone: 'warning',
    });
  }

  const liabilities = accountBalances
    .filter((a) => a.is_liability)
    .reduce((sum, a) => sum + a.balance, 0);
  if (liabilities > 0) {
    alerts.push({
      title: t('Passifs à suivre'),
      detail: t('{{amount}} de crédits/emprunts sont intégrés au patrimoine net.', { amount: fmt(liabilities) }),
      tone: 'info',
    });
  }
  return alerts;
}
