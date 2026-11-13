import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Account, StatisticsSummary, Transaction } from '@suzanne/shared';
import { api } from '../lib/api';
import { seriesColor, useChartTheme, useIsNarrow } from '../lib/chartTheme';
import { formatMonth, money as moneyFmt, moneyCompact as moneyCompactFmt, truncate } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { CashflowTrends } from '../components/CashflowTrends';
import { DrilldownPopover } from '../components/DrilldownPopover';
import { EmptyChart } from '../components/EmptyChart';
import '../styles/pages/plan.css';
import '../styles/pages/statistics.css';

// État du popover de drill-down : où il est ancré, ce qu'on a cliqué, et les
// transactions correspondantes une fois chargées.
interface DrillState {
  x: number;
  y: number;
  title: string;
  filter: { category?: number; q?: string };
  loading: boolean;
  rows: Transaction[];
}

// "Statistiques" — dépenses et cashflow sur une même plage libre.
export function Statistics({ userId, reportCurrency, accountById }: {
  userId: number;
  reportCurrency: string;
  accountById: Map<number, Account>;
}) {
  const navigate = useNavigate();
  const [range, setRange] = usePersistedState('stats_range', '1y');
  const [excludeUncategorized, setExcludeUncategorized] = usePersistedState('stats_exclude_uncategorized', true);
  const [customFrom, setCustomFrom] = usePersistedState('stats_custom_from', '');
  const [customTo, setCustomTo] = usePersistedState('stats_custom_to', '');
  const [data, setData] = useState<StatisticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustom = range === 'custom';
  const effectiveFrom = isCustom ? customFrom : null;
  const effectiveTo = isCustom ? customTo : null;
  const customReady = !isCustom || (Boolean(customFrom) && Boolean(customTo));
  const chartTheme = useChartTheme();
  const chartGrid = chartTheme.grid;
  const narrow = useIsNarrow();

  useEffect(() => {
    if (!customReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.statistics(userId, range, reportCurrency, excludeUncategorized, effectiveFrom, effectiveTo)
      .then((row) => { if (!cancelled) setData(row); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, range, reportCurrency, excludeUncategorized, effectiveFrom, effectiveTo, customReady]);

  const currency = data?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, currency);
  const moneyCompact = (value: number) => moneyCompactFmt(value, currency);

  const byCategory = data?.by_category ?? [];
  const byMerchant = data?.by_merchant ?? [];
  const monthly = (data?.monthly ?? []).map((row) => ({ ...row, label: formatMonth(row.month) }));
  const merchantRows = byMerchant.slice(0, 8).map((row) => ({ ...row, label: truncate(row.description, 40) }));
  const cashflowSummary = data ? {
    currency: data.currency,
    monthly_cashflow: data.cashflow.monthly,
    yearly_cashflow: data.cashflow.yearly,
  } : null;

  const totalDisplayed = excludeUncategorized ? (data?.total_categorized ?? 0) : (data?.total_expenses ?? 0);
  const monthsCount = monthly.length;
  const averagePerMonth = monthsCount > 0 ? totalDisplayed / monthsCount : 0;

  // Drill-down : un clic sur une catégorie ou un marchand ouvre un popover
  // listant les transactions correspondantes sur la plage affichée — les
  // agrégats couvrent plusieurs mois, on ne peut pas deviner lequel ouvrir.
  const [drill, setDrill] = useState<DrillState | null>(null);
  const drillSeq = useRef(0);
  const openDrilldown = (
    at: { clientX: number; clientY: number },
    title: string,
    filter: { category?: number; q?: string },
  ) => {
    if (!data) return;
    const seq = ++drillSeq.current;
    setDrill({ x: at.clientX, y: at.clientY, title, filter, loading: true, rows: [] });
    api.findTransactions(userId, {
      ...(filter.category ? { category_id: filter.category } : {}),
      ...(filter.q ? { q: filter.q } : {}),
      from: data.from,
      to: data.to,
      limit: 50,
    })
      .then((rows) => {
        if (drillSeq.current === seq) setDrill((prev) => (prev ? { ...prev, loading: false, rows } : prev));
      })
      .catch(() => {
        if (drillSeq.current === seq) setDrill((prev) => (prev ? { ...prev, loading: false, rows: [] } : prev));
      });
  };
  // Choisir une transaction : Transactions s'ouvre sur son mois, avec le
  // filtre du drill-down appliqué et la ligne mise en évidence.
  const pickTransaction = (t: Transaction) => {
    const params = new URLSearchParams();
    params.set('month', t.date.slice(0, 7));
    if (drill?.filter.category) params.set('category', String(drill.filter.category));
    if (drill?.filter.q) params.set('q', drill.filter.q);
    params.set('tx', String(t.id));
    navigate(`/transactions?${params.toString()}`);
  };
  // Les handlers recharts reçoivent (data, index, event) — l'event porte les
  // coordonnées du clic pour ancrer le popover.
  const clickPoint = (event: unknown): { clientX: number; clientY: number } => {
    const e = event as { clientX?: number; clientY?: number } | undefined;
    return {
      clientX: e?.clientX ?? window.innerWidth / 2,
      clientY: e?.clientY ?? window.innerHeight / 3,
    };
  };

  const rangeDays = data ? Math.max(1, Math.round((new Date(data.to).getTime() - new Date(data.from).getTime()) / 86_400_000)) : 0;
  const pieRows = byCategory.filter((row) => row.amount > 0);
  const pieTotal = pieRows.reduce((sum, row) => sum + row.amount, 0);
  const visibleCategories = pieRows.slice(0, 7);
  const otherCategories = pieRows.slice(7);
  const otherAmount = otherCategories.reduce((sum, row) => sum + row.amount, 0);
  const donutRows = otherAmount > 0
    ? [...visibleCategories, { category_id: null, name: 'Autres', color: '', amount: otherAmount, transactions_count: 0 }]
    : visibleCategories;
  const maxMerchant = merchantRows[0]?.amount ?? 0;
  const dateFr = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  };

  return (
    <section className="pg stats-page">
      <div className="st-controls">
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Période">
          <option value="3m">3 mois</option>
          <option value="6m">6 mois</option>
          <option value="1y">12 mois</option>
          <option value="2y">2 ans</option>
          <option value="all">Tout</option>
          <option value="custom">Personnalisée…</option>
        </select>
        {isCustom && (
          <>
            <label className="st-date">Du <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
            <label className="st-date">Au <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
          </>
        )}
        <label className="st-check">
          <input type="checkbox" checked={excludeUncategorized} onChange={(e) => setExcludeUncategorized(e.target.checked)} /> Exclure le non-catégorisé
        </label>
      </div>
      {error && <div className="pg-alert" role="alert">{error}</div>}

      <div className="pg-hero">
        <div>
          <span className="pg-kicker">
            Dépenses · {isCustom && !customReady ? 'choisis une période' : data ? `${dateFr(data.from)} → ${dateFr(data.to)}` : loading ? 'chargement…' : '—'}
          </span>
          <strong className="pg-hero-value">{money(totalDisplayed)}</strong>
          <p className="pg-hero-sub">
            <strong>{money(averagePerMonth)}</strong> par mois en moyenne
            {data && excludeUncategorized && data.total_uncategorized > 0 && <> · {money(data.total_uncategorized)} non catégorisés exclus</>}
          </p>
        </div>
      </div>

      <div className="pg-stats">
        <div className="pg-stat"><span>Transactions</span><strong>{data?.transactions_count ?? 0}</strong></div>
        <div className="pg-stat"><span>Catégories</span><strong>{byCategory.length}</strong></div>
        <div className="pg-stat"><span>Mois couverts</span><strong>{monthsCount}</strong></div>
        <div className="pg-stat"><span>Par jour</span><strong>{money(rangeDays > 0 ? totalDisplayed / rangeDays : 0)}</strong></div>
      </div>

      <div className="st-grid">
        <div className="pg-card">
          <div className="pg-card-head"><h2>Par catégorie</h2></div>
          <div className="st-split">
            <div className="st-donut">
              {donutRows.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutRows}
                      dataKey="amount"
                      nameKey="name"
                      innerRadius="62%"
                      outerRadius="92%"
                      paddingAngle={1.5}
                      stroke={chartTheme.tooltip.contentStyle.background as string}
                      strokeWidth={2}
                      isAnimationActive={false}
                      style={{ cursor: 'pointer' }}
                      onClick={(entry, _index, event) => {
                        const payload = (entry as { payload?: { category_id?: number | null; name?: string } })?.payload;
                        if (payload?.category_id != null) {
                          openDrilldown(clickPoint(event), payload.name ?? 'Catégorie', { category: payload.category_id });
                        }
                      }}
                    >
                      {donutRows.map((row, index) => <Cell key={row.category_id ?? row.name} fill={row.category_id == null && row.name === 'Autres' ? chartTheme.grid : seriesColor(chartTheme, index)} />)}
                    </Pie>
                    <Tooltip formatter={(value) => money(Number(value))} contentStyle={chartTheme.tooltip.contentStyle} labelStyle={chartTheme.tooltip.labelStyle} itemStyle={chartTheme.tooltip.itemStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Aucune dépense sur cette période." />
              )}
            </div>
            {donutRows.length > 0 && (
              <ul className="st-legend">
                {donutRows.map((row, index) => {
                  const isOther = row.category_id == null && row.name === 'Autres' && otherAmount > 0;
                  const color = isOther ? chartTheme.grid : seriesColor(chartTheme, index);
                  const share = pieTotal > 0 ? Math.round((row.amount / pieTotal) * 100) : 0;
                  const inner = (
                    <>
                      <span className="st-swatch" style={{ background: color }} />
                      <span className="st-legend-name" title={row.name}>{isOther ? `Autres (${otherCategories.length})` : row.name}</span>
                      <span className="st-legend-share">{share} %</span>
                      <strong>{money(row.amount)}</strong>
                    </>
                  );
                  return (
                    <li key={`${row.category_id ?? row.name}-${index}`}>
                      {row.category_id != null ? (
                        <button type="button" className="st-legend-row" onClick={(e) => openDrilldown(e, row.name, { category: row.category_id! })}>{inner}</button>
                      ) : <div className="st-legend-row">{inner}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="pg-card">
          <div className="pg-card-head"><h2>Top marchands</h2></div>
          {merchantRows.length > 0 ? (
            <ul className="st-bars">
              {merchantRows.map((row) => (
                <li key={row.description}>
                  <button type="button" className="st-bar-row" onClick={(e) => openDrilldown(e, row.description, { q: row.description })}>
                    <span className="st-bar-label" title={row.description}>{row.label}</span>
                    <strong>{money(row.amount)}</strong>
                    <span className="st-bar"><span style={{ width: `${maxMerchant > 0 ? (row.amount / maxMerchant) * 100 : 0}%` }} /></span>
                    <small>{row.transactions_count} opération{row.transactions_count > 1 ? 's' : ''}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pg-empty">Aucun marchand identifiable. Ajoute des libellés à tes transactions.</p>
          )}
        </div>
      </div>

      <div className="pg-card">
        <div className="pg-card-head"><h2>Dépenses par mois</h2></div>
        <div className="pg-card-body">
          <div className="pg-chart">
            {monthly.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGrid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={chartTheme.tick} minTickGap={narrow ? 8 : 4} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={narrow ? 50 : 66} tick={chartTheme.tick} />
                  <Tooltip formatter={(value) => money(Number(value))} contentStyle={chartTheme.tooltip.contentStyle} labelStyle={chartTheme.tooltip.labelStyle} itemStyle={chartTheme.tooltip.itemStyle} cursor={chartTheme.tooltip.cursor} />
                  {averagePerMonth > 0 && <ReferenceLine y={averagePerMonth} stroke={chartTheme.axis} strokeDasharray="4 4" />}
                  <Bar dataKey="amount" name="Dépenses" fill={chartTheme.total} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Pas encore d'historique mensuel." />
            )}
          </div>
          {averagePerMonth > 0 && <p className="pg-note">Pointillés : moyenne mensuelle ({money(averagePerMonth)}).</p>}
        </div>
      </div>

      <h2 className="st-section">Cashflow &amp; épargne</h2>
      <CashflowTrends summary={cashflowSummary} reportCurrency={reportCurrency} />

      {drill && (
        <DrilldownPopover
          x={drill.x}
          y={drill.y}
          title={drill.title}
          loading={drill.loading}
          transactions={drill.rows}
          accountById={accountById}
          onPick={pickTransaction}
          onClose={() => setDrill(null)}
        />
      )}
    </section>
  );
}
