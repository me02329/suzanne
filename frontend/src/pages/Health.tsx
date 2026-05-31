import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PiggyBank, Repeat, ShieldCheck, Target } from 'lucide-react';
import type { Account, Budget, Category, DashboardSummary, RecurringTransaction } from '@suzanne-lite/shared';
import { formatMonth, money as moneyFmt } from '../lib/format';
import { useChartTheme } from '../lib/chartTheme';
import { liquidBalance } from '../lib/balances';
import { computeHealth, type HealthRating } from '../lib/health';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';

const RATING_LABEL: Record<HealthRating, string> = {
  good: 'Sain',
  warn: 'À surveiller',
  bad: 'À risque',
  unknown: '—',
};

const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)} %`);

export function Health({ summary, recurring, budgets, reportCurrency, categoryById, accountById }: {
  summary: DashboardSummary | null;
  recurring: RecurringTransaction[];
  budgets: Budget[];
  reportCurrency: string;
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
}) {
  const chartTheme = useChartTheme();
  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);

  const rateFor = useMemo(() => {
    const rates = summary?.exchange_rates ?? {};
    return (accountId: number | null) => {
      const currency = (accountId != null ? accountById.get(accountId)?.currency : null) ?? 'EUR';
      return rates[currency] ?? 1;
    };
  }, [summary, accountById]);

  const health = useMemo(() => computeHealth({
    monthlyCashflow: summary?.monthly_cashflow ?? [],
    liquidBalance: liquidBalance(summary),
    recurring,
    budgets,
    expensesByCategory: summary?.expenses_by_category ?? [],
    categoryById,
    rateFor,
  }), [summary, recurring, budgets, categoryById, rateFor]);

  if (!summary) return <p className="empty">Chargement des données…</p>;

  const { savingsRate, emergencyFund, recurringLoad, fixedVsVariable, budgetAdherence } = health;
  const budgetRating: HealthRating = budgetAdherence === null
    ? 'unknown'
    : budgetAdherence.overCount === 0
      ? 'good'
      : budgetAdherence.overCount <= budgetAdherence.items.length / 2
        ? 'warn'
        : 'bad';

  const monthlyExpenseTotal = fixedVsVariable.fixed + fixedVsVariable.variable;
  const fixedPct = monthlyExpenseTotal > 0 ? (fixedVsVariable.fixed / monthlyExpenseTotal) * 100 : 0;
  const rateSeries = savingsRate.series.map((p) => ({ ...p, label: formatMonth(p.month) }));

  return (
    <section className="stack">
      <p className="panel-note">
        Des indicateurs de <strong>santé financière</strong> — des ratios, complémentaires aux montants bruts du tableau de bord et des statistiques.
        Calculés sur tes 12 derniers mois et l'état courant.
      </p>

      <section className="health-grid">
        <HealthCard
          icon={<PiggyBank />}
          label="Taux d'épargne"
          value={pct(savingsRate.current)}
          sub={`Moyenne 12 mois : ${pct(savingsRate.average)}`}
          rating={savingsRate.rating}
        />
        <HealthCard
          icon={<ShieldCheck />}
          label="Fonds d'urgence"
          value={emergencyFund.monthsCovered === null ? '—' : `${emergencyFund.monthsCovered.toFixed(1)} mois`}
          sub={`Dépenses ≈ ${money(emergencyFund.avgMonthlyExpenses)}/mois`}
          rating={emergencyFund.rating}
        />
        <HealthCard
          icon={<Repeat />}
          label="Charge des récurrents"
          value={pct(recurringLoad.share)}
          sub={`${money(recurringLoad.monthlyFixed)}/mois de charges fixes`}
          rating={recurringLoad.rating}
        />
        <HealthCard
          icon={<Target />}
          label="Adhérence budgets"
          value={budgetAdherence === null ? '—' : `${budgetAdherence.withinCount}/${budgetAdherence.items.length}`}
          sub={budgetAdherence === null ? 'Aucun budget défini' : `${budgetAdherence.overCount} dépassé${budgetAdherence.overCount > 1 ? 's' : ''} ce mois`}
          rating={budgetRating}
        />
      </section>

      <section className="charts-grid">
        <Panel title="Évolution du taux d'épargne" icon={<PiggyBank />}>
          <div className="chart-area">
            {rateSeries.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rateSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} tickLine={false} axisLine={false} width={48} />
                  <Tooltip formatter={(v) => pct(Number(v))} />
                  <Line type="monotone" dataKey="rate" name="Taux d'épargne" stroke={chartTheme.net} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Pas encore assez d'historique de revenus." />
            )}
          </div>
        </Panel>

        <Panel title="Charges fixes vs variables" icon={<Repeat />}>
          {monthlyExpenseTotal > 0 ? (
            <div className="health-split">
              <div className="health-split-bar">
                <span className="fixed" style={{ width: `${fixedPct}%` }} />
                <span className="variable" style={{ width: `${100 - fixedPct}%` }} />
              </div>
              <div className="health-split-legend">
                <div><span className="dot fixed" /> Fixes (récurrents) <strong>{money(fixedVsVariable.fixed)}</strong></div>
                <div><span className="dot variable" /> Variables <strong>{money(fixedVsVariable.variable)}</strong></div>
              </div>
              <p className="panel-note">Sur une dépense mensuelle moyenne de {money(monthlyExpenseTotal)}. Les charges fixes proviennent des récurrents actifs.</p>
            </div>
          ) : (
            <p className="empty">Pas encore de dépenses à répartir.</p>
          )}
        </Panel>
      </section>

      {budgetAdherence && budgetAdherence.items.length > 0 && (
        <section className="chart-full">
          <Panel title="Adhérence aux budgets du mois" icon={<Target />}>
            <div className="health-budgets">
              {budgetAdherence.items.map((item) => {
                const width = Math.min(100, item.ratio * 100);
                return (
                  <div className="health-budget" key={item.categoryId}>
                    <div className="health-budget-head">
                      <span>{item.name}</span>
                      <span className={item.over ? 'expense' : 'muted'}>{money(item.spent)} / {money(item.limit)}</span>
                    </div>
                    <div className="bar"><span style={{ width: `${width}%`, background: item.over ? 'var(--expense)' : 'var(--accent)' }} /></div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </section>
      )}
    </section>
  );
}

function HealthCard({ icon, label, value, sub, rating }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  rating: HealthRating;
}) {
  return (
    <div className="health-card">
      <div className="health-card-head">
        <span className="health-icon">{icon}</span>
        <span className={`health-badge ${rating}`}>{RATING_LABEL[rating]}</span>
      </div>
      <span className="health-label">{label}</span>
      <strong className="health-value">{value}</strong>
      <span className="health-sub">{sub}</span>
    </div>
  );
}
