import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Account, Budget, Category, DashboardSummary, RecurringTransaction } from '@suzanne/shared';
import { money as moneyFmt } from '../lib/format';
import { liquidBalance } from '../lib/balances';
import { computeHealth, type HealthRating } from '../lib/health';
import '../styles/pages/plan.css';
import '../styles/pages/home.css';

const RATING_LABEL: Record<HealthRating, string> = {
  good: 'Sain',
  warn: 'À surveiller',
  bad: 'À risque',
  unknown: '—',
};

const pct = (value: number | null) => (value === null ? '—' : value < -1 ? '< −100 %' : `${Math.round(value * 100)} %`);

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

  const ratings = [savingsRate.rating, emergencyFund.rating, recurringLoad.rating, budgetRating].filter((r) => r !== 'unknown');
  const goodCount = ratings.filter((r) => r === 'good').length;
  const verdict = ratings.length === 0 ? 'Pas encore assez de données'
    : ratings.includes('bad') ? 'Des points à risque'
      : ratings.includes('warn') ? 'Quelques points à surveiller'
        : 'Tout est au vert';

  return (
    <section className="pg home-sub">
      <div className="pg-hero">
        <div>
          <span className="pg-kicker">Santé financière · 12 derniers mois</span>
          <strong className="pg-hero-value">{goodCount} <small>/ {ratings.length || 4} indicateurs sains</small></strong>
          <p className="pg-hero-sub">{verdict}</p>
        </div>
      </div>

      <div className="health2-grid">
        <HealthCard
          label="Taux d'épargne"
          value={pct(savingsRate.current)}
          sub={`Moyenne 12 mois : ${pct(savingsRate.average)}`}
          rating={savingsRate.rating}
          to="/statistics"
        />
        <HealthCard
          label="Fonds d'urgence"
          value={emergencyFund.monthsCovered === null ? '—' : `${emergencyFund.monthsCovered.toFixed(1).replace('.', ',')} mois`}
          sub={`Dépenses ≈ ${money(emergencyFund.avgMonthlyExpenses)}/mois`}
          rating={emergencyFund.rating}
          to="/accounts"
        />
        <HealthCard
          label="Charges fixes"
          value={pct(recurringLoad.share)}
          sub={`${money(recurringLoad.monthlyFixed)}/mois de récurrents`}
          rating={recurringLoad.rating}
          to="/recurring"
        />
        <HealthCard
          label="Budgets tenus"
          value={budgetAdherence === null ? '—' : `${budgetAdherence.withinCount}/${budgetAdherence.items.length}`}
          sub={budgetAdherence === null ? 'Aucun budget défini' : `${budgetAdherence.overCount} dépassé${budgetAdherence.overCount > 1 ? 's' : ''} ce mois`}
          rating={budgetRating}
          to="/budgets"
        />
      </div>

      <div className="pg-card">
        <div className="pg-card-head"><h2>Fixes ou variables ?</h2></div>
        <div className="pg-card-body">
          {monthlyExpenseTotal > 0 ? (
            <>
              <div className="health2-split" role="img" aria-label={`${Math.round(fixedPct)} % de charges fixes`}>
                <span className="fixed" style={{ width: `${fixedPct}%` }} />
                <span className="variable" style={{ width: `${100 - fixedPct}%` }} />
              </div>
              <div className="health2-legend">
                <div><span className="home-swatch fixed" /> Fixes <strong>{money(fixedVsVariable.fixed)}</strong> <span className="pg-note">{Math.round(fixedPct)} %</span></div>
                <div><span className="home-swatch variable" /> Variables <strong>{money(fixedVsVariable.variable)}</strong></div>
              </div>
              <p className="pg-note" style={{ marginTop: 12 }}>Sur une dépense mensuelle moyenne de {money(monthlyExpenseTotal)}. Les charges fixes viennent des récurrents actifs.</p>
            </>
          ) : (
            <p className="pg-note">Pas encore de dépenses à répartir.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function HealthCard({ label, value, sub, rating, to }: {
  label: string;
  value: string;
  sub: string;
  rating: HealthRating;
  // Page de référence où consulter le détail de l'indicateur et agir.
  to: string;
}) {
  return (
    <Link className="health2-card" to={to}>
      <div className="health2-card-head">
        <span>{label}</span>
        <span className={`health2-badge ${rating}`}>{RATING_LABEL[rating]}</span>
      </div>
      <strong className="health2-value">{value}</strong>
      <span className="health2-sub">{sub}</span>
    </Link>
  );
}
