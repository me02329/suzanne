import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PiggyBank, Repeat, ShieldCheck, Target } from 'lucide-react';
import type { Account, Budget, Category, DashboardSummary, RecurringTransaction } from '@suzanne-lite/shared';
import { money as moneyFmt } from '../lib/format';
import { liquidBalance } from '../lib/balances';
import { computeHealth, type HealthRating } from '../lib/health';
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

  return (
    <section className="stack">
      <p className="panel-note">
        Des indicateurs de <strong>santé financière</strong> — des ratios, complémentaires aux montants bruts de la vue générale et des statistiques.
        Calculés sur tes 12 derniers mois et l'état courant. Chaque carte mène à la page où consulter le détail et agir.
      </p>

      <section className="health-grid">
        <HealthCard
          icon={<PiggyBank />}
          label="Taux d'épargne"
          value={pct(savingsRate.current)}
          sub={`Moyenne 12 mois : ${pct(savingsRate.average)}`}
          rating={savingsRate.rating}
          to="/statistics"
        />
        <HealthCard
          icon={<ShieldCheck />}
          label="Fonds d'urgence"
          value={emergencyFund.monthsCovered === null ? '—' : `${emergencyFund.monthsCovered.toFixed(1)} mois`}
          sub={`Dépenses ≈ ${money(emergencyFund.avgMonthlyExpenses)}/mois`}
          rating={emergencyFund.rating}
          to="/accounts"
        />
        <HealthCard
          icon={<Repeat />}
          label="Charge des récurrents"
          value={pct(recurringLoad.share)}
          sub={`${money(recurringLoad.monthlyFixed)}/mois de charges fixes`}
          rating={recurringLoad.rating}
          to="/recurring"
        />
        <HealthCard
          icon={<Target />}
          label="Adhérence budgets"
          value={budgetAdherence === null ? '—' : `${budgetAdherence.withinCount}/${budgetAdherence.items.length}`}
          sub={budgetAdherence === null ? 'Aucun budget défini' : `${budgetAdherence.overCount} dépassé${budgetAdherence.overCount > 1 ? 's' : ''} ce mois`}
          rating={budgetRating}
          to="/budgets"
        />
      </section>

      <section className="charts-grid">
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

    </section>
  );
}

function HealthCard({ icon, label, value, sub, rating, to }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  rating: HealthRating;
  // Page de référence où consulter le détail de l'indicateur et agir.
  to: string;
}) {
  return (
    <Link className="health-card" to={to}>
      <div className="health-card-head">
        <span className="health-icon">{icon}</span>
        <span className={`health-badge ${rating}`}>{RATING_LABEL[rating]}</span>
      </div>
      <span className="health-label">{label}</span>
      <strong className="health-value">{value}</strong>
      <span className="health-sub">{sub}</span>
    </Link>
  );
}
