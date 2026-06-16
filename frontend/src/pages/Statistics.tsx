import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CalendarDays, Gauge, Tags, TrendingDown } from 'lucide-react';
import type { Account, StatisticsSummary, Transaction } from '@suzanne/shared';
import { api } from '../lib/api';
import { useChartTheme } from '../lib/chartTheme';
import { formatMonth, money as moneyFmt, moneyCompact as moneyCompactFmt, truncate } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { CashflowTrends } from '../components/CashflowTrends';
import { DashboardSection } from '../components/DashboardSection';
import { DrilldownPopover } from '../components/DrilldownPopover';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';

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
  const expenseColor = chartTheme.expense;

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
  const merchantRows = byMerchant.slice(0, 10).map((row) => ({ ...row, label: truncate(row.description, 28) }));
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

  return (
    <section className="stack">
      <DashboardSection title="Dépenses" subtitle="Analyse des dépenses sur la plage choisie ci-dessous">
      <div className="stats-controls">
        <select value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="3m">3 mois</option>
          <option value="6m">6 mois</option>
          <option value="1y">12 mois</option>
          <option value="2y">2 ans</option>
          <option value="all">Tout</option>
          <option value="custom">Personnalisée…</option>
        </select>
        {isCustom && (
          <>
            <label className="inline-date">Du <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
            <label className="inline-date">Au <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
          </>
        )}
        <label className="series-toggles inline">
          <input type="checkbox" checked={excludeUncategorized} onChange={(e) => setExcludeUncategorized(e.target.checked)} /> Exclure non-catégorisé
        </label>
        <span className="stats-controls-note">
          {isCustom && !customReady
            ? 'Choisis une date de début et de fin.'
            : data
              ? `${data.transactions_count} transactions · ${new Date(data.from).toLocaleDateString('fr-FR')} → ${new Date(data.to).toLocaleDateString('fr-FR')}`
              : loading
                ? 'Chargement…'
                : '—'}
          {data && excludeUncategorized && data.total_uncategorized > 0 && (
            <> · <strong>{money(data.total_uncategorized)}</strong> exclus</>
          )}
        </span>
      </div>
      {error && <div className="error">{error}</div>}

      <section className="stats">
        <Stat icon={<TrendingDown />} label="Dépenses sur la plage" value={money(totalDisplayed)} negative />
        <Stat icon={<Gauge />} label="Moyenne mensuelle" value={money(averagePerMonth)} />
        <Stat icon={<Tags />} label="Catégories actives" value={String(byCategory.length)} />
        <Stat icon={<CalendarDays />} label="Mois couverts" value={String(monthsCount)} />
      </section>

      <section className="charts-grid">
        <Panel title="Répartition par catégorie">
          <div className="chart-split">
            <div className="donut-area">
              {byCategory.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byCategory}
                      dataKey="amount"
                      nameKey="name"
                      innerRadius="58%"
                      outerRadius="86%"
                      paddingAngle={2}
                      isAnimationActive={false}
                      style={{ cursor: 'pointer' }}
                      onClick={(entry, _index, event) => {
                        const payload = (entry as { payload?: { category_id?: number | null; name?: string } })?.payload;
                        if (payload?.category_id != null) {
                          openDrilldown(clickPoint(event), payload.name ?? 'Catégorie', { category: payload.category_id });
                        }
                      }}
                    >
                      {byCategory.map((row) => <Cell key={row.category_id ?? row.name} fill={row.color} />)}
                    </Pie>
                    <Tooltip formatter={(value) => money(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Aucune dépense sur cette plage." />
              )}
            </div>
            <div className="category-list compact">
              {byCategory.slice(0, 12).map((row) => row.category_id != null ? (
                <button
                  type="button"
                  className="category-row category-link"
                  key={row.category_id}
                  onClick={(e) => openDrilldown(e, row.name, { category: row.category_id! })}
                >
                  <span className="dot" style={{ background: row.color }} />
                  <span title={row.name}>{row.name}</span>
                  <strong>{money(row.amount)}</strong>
                </button>
              ) : (
                <div className="category-row" key={row.name}>
                  <span className="dot" style={{ background: row.color }} />
                  <span title={row.name}>{row.name}</span>
                  <strong>{money(row.amount)}</strong>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Top marchands">
          <div className="chart-area">
            {merchantRows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={merchantRows} layout="vertical" margin={{ top: 8, right: 8, left: 16, bottom: 0 }}>
                  <CartesianGrid stroke={chartGrid} horizontal={false} />
                  <XAxis type="number" tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    width={170}
                  />
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Bar
                    dataKey="amount"
                    name="Cumul"
                    fill={expenseColor}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                    style={{ cursor: 'pointer' }}
                    onClick={(entry, _index, event) => {
                      const description = (entry as { payload?: { description?: string } })?.payload?.description;
                      if (description) openDrilldown(clickPoint(event), description, { q: description });
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Aucun marchand identifiable. Ajoute des descriptions à tes transactions." />
            )}
          </div>
        </Panel>
      </section>

      <section className="charts-grid">
        <Panel title="Évolution mensuelle des dépenses — toutes catégories">
          <div className="chart-area">
            {monthly.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGrid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={70} />
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Line type="monotone" dataKey="amount" name="Dépenses" stroke={expenseColor} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Pas encore d'historique mensuel." />
            )}
          </div>
        </Panel>
      </section>
      </DashboardSection>

      <DashboardSection title="Cashflow & épargne" subtitle="Revenus, dépenses et épargne sur la même plage">
        <CashflowTrends summary={cashflowSummary} reportCurrency={reportCurrency} />
      </DashboardSection>

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
