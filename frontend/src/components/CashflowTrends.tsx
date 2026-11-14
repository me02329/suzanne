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
import { timeAxisProps, timeTooltipLabel } from '../lib/timeAxis';
import { EmptyChart } from '../components/EmptyChart';
import '../styles/pages/plan.css';
import '../styles/pages/statistics.css';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const chartTheme = useChartTheme();
  const narrow = useIsNarrow();
  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const moneyCompact = (value: number) => moneyCompactFmt(value, displayCurrency);

  const monthRows = (summary?.monthly_cashflow ?? []).map((row) => ({
    ...row,
    label: formatMonth(row.month),
    cumulativeNet: row.cumulative_net,
    // Taux d'épargne du mois (null sans revenus : le point est sauté). Borné à
    // −100 % : un mois quasi sans revenu donnerait −1 000 % et écraserait
    // l'échelle ; la valeur réelle reste lisible dans le tooltip.
    savingRate: row.income > 0 ? Math.max(-1, row.net / row.income) : null,
    savingRateRaw: row.income > 0 ? row.net / row.income : null,
  }));
  // Échelle du taux : bornes rondes (−100 %, −50 %, 0, 50 %, 100 %).
  const rates = monthRows.map((r) => r.savingRate).filter((v): v is number => v != null);
  const rateMin = Math.min(0, ...rates);
  const rateMax = Math.max(0, ...rates);
  const rateDomain: [number, number] = [rateMin < -0.5 ? -1 : rateMin < 0 ? -0.5 : 0, rateMax > 0.5 ? 1 : 0.5];
  const rateTicks = [-1, -0.5, 0, 0.5, 1].filter((v) => v >= rateDomain[0] && v <= rateDomain[1]);
  const monthAxis = timeAxisProps(monthRows.map((r) => r.month), chartTheme.tick, 'month');
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
        <div className="pg-card-head"><h2>{t('accueil.cashflow_trends.income_and_expenses_by_month')}</h2></div>
        <div className="pg-card-body">
          <div className="pg-chart">
            {cashflowHasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthRows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="month" {...monthAxis} minTickGap={narrow ? 8 : 4} />
                  <YAxis tickFormatter={(value) => moneyCompact(Number(value))} {...axis} width={yWidth} />
                  <Tooltip formatter={(value) => money(Number(value))} labelFormatter={timeTooltipLabel('month')} {...tooltip} cursor={chartTheme.tooltip.cursor} />
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
          <div className="pg-card-head"><h2>{t('accueil.cashflow_trends.savings_rate')}</h2></div>
          <div className="pg-card-body">
            <div className="pg-chart small">
              {rateHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthRows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="month" {...monthAxis} minTickGap={20} />
                    <YAxis tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} {...axis} width={48} domain={rateDomain} ticks={rateTicks} />
                    <Tooltip
                      formatter={(_v, _n, item) => {
                        const raw = (item?.payload as { savingRateRaw?: number | null; income?: number; expenses?: number } | undefined);
                        const pct = raw?.savingRateRaw == null ? '—' : `${Math.round(raw.savingRateRaw * 100)} %`;
                        return raw?.savingRateRaw != null && raw.savingRateRaw < -1
                          ? [`${pct} (revenus ${money(raw.income ?? 0)}, dépenses ${money(raw.expenses ?? 0)})`, 'Taux d’épargne']
                          : [pct, 'Taux d’épargne'];
                      }}
                      labelFormatter={timeTooltipLabel('month')}
                      {...tooltip}
                      cursor={{ stroke: chartTheme.axis, strokeDasharray: '3 3' }}
                    />
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
          <div className="pg-card-head"><h2>{t('accueil.cashflow_trends.by_year')}</h2></div>
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
