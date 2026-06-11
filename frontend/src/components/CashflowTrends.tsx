import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CashflowMonth, CashflowYear } from '@suzanne-lite/shared';
import { formatMonth, money as moneyFmt, moneyCompact as moneyCompactFmt } from '../lib/format';
import { useChartTheme } from '../lib/chartTheme';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';

type CashflowTrendsSummary = {
  currency: string;
  monthly_cashflow: CashflowMonth[];
  yearly_cashflow: CashflowYear[];
};

// Tendances revenus/dépenses/épargne sur la plage déjà fournie par l'appelant.
export function CashflowTrends({ summary, reportCurrency }: {
  summary: CashflowTrendsSummary | null;
  reportCurrency: string;
}) {
  const chartTheme = useChartTheme();
  const chartGrid = chartTheme.grid;
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

  return (
    <>
      <section className="chart-full">
        <Panel title="Cashflow par mois">
          <div className="chart-area">
            {cashflowHasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGrid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={70} />
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Legend />
                  <Bar dataKey="income" name="Revenus" fill={chartTheme.income} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses_signed" name="Dépenses" fill={chartTheme.expense} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="cumulativeNet" name="Cumul net" stroke={chartTheme.net} strokeWidth={3} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Pas encore de cashflow à afficher." />
            )}
          </div>
        </Panel>
      </section>

      <section className="charts-grid">
        <Panel title="Tendance annuelle">
          <div className="chart-area small">
            {yearHasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yearRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGrid} vertical={false} />
                  <XAxis dataKey="year" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={70} />
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Legend />
                  <Line type="monotone" dataKey="income" name="Revenus" stroke={chartTheme.income} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="expenses" name="Dépenses" stroke={chartTheme.expense} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="net" name="Net" stroke={chartTheme.net} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Pas encore d'historique annuel." />
            )}
          </div>
        </Panel>

        <Panel title="Taux d'épargne">
          <div className="chart-area small">
            {rateHasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGrid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} tickLine={false} axisLine={false} width={48} />
                  <Tooltip formatter={(v) => `${Math.round(Number(v) * 100)} %`} />
                  <Line type="monotone" dataKey="savingRate" name="Taux d'épargne" stroke={chartTheme.net} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Pas encore assez d'historique de revenus." />
            )}
          </div>
        </Panel>
      </section>
    </>
  );
}
