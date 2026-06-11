import { useEffect, useState } from 'react';
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
import type { DashboardSummary, StatisticsSummary } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { useChartTheme } from '../lib/chartTheme';
import { formatMonth, money as moneyFmt, moneyCompact as moneyCompactFmt, truncate } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { CashflowTrends } from '../components/CashflowTrends';
import { DashboardSection } from '../components/DashboardSection';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';

// "Statistiques" — l'analyse long terme : dépenses sur une plage libre, puis
// cashflow/épargne sur 12 mois (tendances déplacées depuis l'ancien dashboard).
export function Statistics({ userId, reportCurrency, summary }: {
  userId: number;
  reportCurrency: string;
  summary: DashboardSummary | null;
}) {
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

  const totalDisplayed = excludeUncategorized ? (data?.total_categorized ?? 0) : (data?.total_expenses ?? 0);
  const monthsCount = monthly.length;
  const averagePerMonth = monthsCount > 0 ? totalDisplayed / monthsCount : 0;

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
                    <Pie data={byCategory} dataKey="amount" nameKey="name" innerRadius="58%" outerRadius="86%" paddingAngle={2}>
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
              {byCategory.slice(0, 12).map((row) => (
                <div className="category-row" key={row.category_id ?? row.name}>
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
                  <Bar dataKey="amount" name="Cumul" fill={expenseColor} radius={[0, 4, 4, 0]} />
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
                  <Line type="monotone" dataKey="amount" name="Dépenses" stroke={expenseColor} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Pas encore d'historique mensuel." />
            )}
          </div>
        </Panel>
      </section>
      </DashboardSection>

      <DashboardSection title="Cashflow & épargne" subtitle="12 derniers mois et années — indépendant de la plage ci-dessus">
        <CashflowTrends summary={summary} reportCurrency={reportCurrency} />
      </DashboardSection>
    </section>
  );
}
