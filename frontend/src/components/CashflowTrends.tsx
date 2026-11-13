import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CashflowMonth, CashflowYear } from '@suzanne/shared';
import { formatMonth, money as moneyFmt, moneyCompact as moneyCompactFmt } from '../lib/format';
import { useChartTheme, useIsNarrow } from '../lib/chartTheme';
import { EmptyChart } from '../components/EmptyChart';
import '../styles/pages/plan.css';
import '../styles/pages/statistics.css';

type CashflowTrendsSummary = {
  currency: string;
  monthly_cashflow: CashflowMonth[];
  yearly_cashflow: CashflowYear[];
};

// Tendances revenus/dépenses/épargne sur la plage déjà fournie par l'appelant.
// Légendes sous les graphiques, axes compacts sur mobile.
export function CashflowTrends({ summary, reportCurrency }: {
  summary: CashflowTrendsSummary | null;
  reportCurrency: string;
}) {
  const chartTheme = useChartTheme();
  const narrow = useIsNarrow();
  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const moneyCompact = (value: number) => moneyCompactFmt(value, displayCurrency);

  const monthRows = (summary?.monthly_cashflow ?? []).map((row) => ({
    ...row,
    label: formatMonth(row.month),
    cumulativeNet: row.cumulative_net,
    // Taux d'épargne du mois (null sans revenus : le point est sauté).
    savingRate: row.income > 0 ? row.net / row.income : null,
  }));
  const yearRows = summary?.yearly_cashflow ?? [];
  const cashflowHasData = monthRows.some((row) => row.income !== 0 || row.expenses !== 0);
  const yearHasData = yearRows.some((row) => row.income !== 0 || row.expenses !== 0);
  const rateHasData = monthRows.some((row) => row.savingRate !== null);

  const axis = {
    tickLine: false,
    axisLine: false,
    tick: chartTheme.tick,
  } as const;
  const yWidth = narrow ? 58 : 66;
  const tooltip = {
    contentStyle: chartTheme.tooltip.contentStyle,
    labelStyle: chartTheme.tooltip.labelStyle,
    itemStyle: chartTheme.tooltip.itemStyle,
  };
  const legend = <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12.5, paddingTop: 8, color: chartTheme.axis }} />;

  return (
    <div className="st-trends">
      <div className="pg-card">
        <div className="pg-card-head"><h2>Revenus et dépenses par mois</h2></div>
        <div className="pg-card-body">
          <div className="pg-chart">
            {cashflowHasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthRows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="label" {...axis} minTickGap={narrow ? 8 : 4} />
                  <YAxis tickFormatter={(value) => moneyCompact(Number(value))} {...axis} width={yWidth} />
                  <Tooltip formatter={(value) => money(Number(value))} {...tooltip} cursor={chartTheme.tooltip.cursor} />
                  <ReferenceLine y={0} stroke={chartTheme.axis} strokeOpacity={0.5} />
                  {legend}
                  <Bar dataKey="income" name="Revenus" fill={chartTheme.income} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  <Bar dataKey="expenses_signed" name="Dépenses" fill={chartTheme.expense} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  <Line type="monotone" dataKey="cumulativeNet" name="Cumul net" stroke={chartTheme.total} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Pas encore de cashflow à afficher." />
            )}
          </div>
        </div>
      </div>

      <div className="st-trends-row">
        <div className="pg-card">
          <div className="pg-card-head"><h2>Taux d’épargne</h2></div>
          <div className="pg-card-body">
            <div className="pg-chart small">
              {rateHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthRows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="label" {...axis} minTickGap={20} />
                    <YAxis tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} {...axis} width={44} />
                    <Tooltip formatter={(v) => `${Math.round(Number(v) * 100)} %`} {...tooltip} cursor={{ stroke: chartTheme.axis, strokeDasharray: '3 3' }} />
                    <ReferenceLine y={0} stroke={chartTheme.axis} strokeOpacity={0.5} />
                    <Line type="monotone" dataKey="savingRate" name="Taux d'épargne" stroke={chartTheme.net} strokeWidth={2} dot={{ r: 2.5, fill: chartTheme.net }} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Pas encore assez d'historique de revenus." />
              )}
            </div>
          </div>
        </div>

        <div className="pg-card">
          <div className="pg-card-head"><h2>Par année</h2></div>
          <div className="pg-card-body">
            <div className="pg-chart small">
              {yearHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={yearRows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="year" {...axis} />
                    <YAxis tickFormatter={(value) => moneyCompact(Number(value))} {...axis} width={yWidth} />
                    <Tooltip formatter={(value) => money(Number(value))} {...tooltip} cursor={{ stroke: chartTheme.axis, strokeDasharray: '3 3' }} />
                    {legend}
                    <Line type="monotone" dataKey="income" name="Revenus" stroke={chartTheme.income} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="expenses" name="Dépenses" stroke={chartTheme.expense} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="net" name="Net" stroke={chartTheme.total} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="Pas encore d'historique annuel." />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
