import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import type { Account, Category, DashboardSummary, RecurringTransaction, SavingsGoal } from '@suzanne/shared';
import { money as moneyFmt, moneyCompact as moneyCompactFmt, formatRelativeDate } from '../lib/format';
import { useChartTheme, useIsNarrow } from '../lib/chartTheme';
import { usePersistedState } from '../lib/storage';
import { isLiquidRecurring, liquidBalance } from '../lib/balances';
import { buildForecast, groupForecastEvents } from '../lib/forecast';
import { EmptyChart } from '../components/EmptyChart';
import '../styles/pages/plan.css';

const HORIZONS: Array<{ value: string; label: string }> = [
  { value: '30', label: '30 jours' },
  { value: '60', label: '60 jours' },
  { value: '90', label: '90 jours' },
  { value: '180', label: '6 mois' },
  { value: '365', label: '12 mois' },
];

const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

export function Forecast({ recurring, accounts, goals, summary, reportCurrency, categoryById, accountById }: {
  recurring: RecurringTransaction[];
  accounts: Account[];
  goals: SavingsGoal[];
  summary: DashboardSummary | null;
  reportCurrency: string;
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
}) {
  const [horizon, setHorizon] = usePersistedState('forecast_horizon', '90');
  const chartTheme = useChartTheme();
  const narrow = useIsNarrow();
  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const moneyCompact = (value: number) => moneyCompactFmt(value, displayCurrency);

  // Starting point: sum of the liquid accounts' balances, already converted to
  // the report currency by the dashboard endpoint.
  const startingBalance = useMemo(() => liquidBalance(summary), [summary]);

  // Project only the recurring that actually move that liquid balance — a
  // recurring on an investment/crypto/liability account would distort a
  // projection meant to track cash alone.
  const liquidRecurring = useMemo(
    () => recurring.filter((r) => isLiquidRecurring(r, accountById)),
    [recurring, accountById],
  );

  const rateFor = useMemo(() => {
    const rates = summary?.exchange_rates ?? {};
    return (accountId: number | null) => {
      const currency = (accountId != null ? accountById.get(accountId)?.currency : null) ?? 'EUR';
      return rates[currency] ?? 1;
    };
  }, [summary, accountById]);

  const forecast = useMemo(() => buildForecast({
    horizonDays: Number(horizon),
    startingBalance,
    recurring: liquidRecurring,
    goals,
    rateFor,
  }), [horizon, startingBalance, liquidRecurring, goals, rateFor]);

  const netFlow = forecast.totalIncome - forecast.totalExpenses;
  const goesNegative = forecast.lowestBalance < 0;
  const chartData = forecast.series.map((point) => ({ ...point, label: shortDate(point.date) }));

  // Échéances groupées par semaine (horizons courts) ou par mois : la table
  // brute pouvait dépasser la centaine de lignes sur 12 mois. Dépliés par
  // défaut : les 2 premiers groupes + celui qui contient le point bas.
  const groupMode = Number(horizon) <= 90 ? 'week' : 'month';
  const eventGroups = useMemo(() => groupForecastEvents(forecast.events, groupMode), [forecast, groupMode]);
  // Transient (non persisté) : `null`/absent = état par défaut du groupe.
  const [expandedOverride, setExpandedOverride] = useState<Record<string, boolean>>({});
  const isExpanded = (key: string, index: number) =>
    expandedOverride[key]
    ?? (index < 2 || eventGroups[index]?.events.some((e) => e.date === forecast.lowestDate && goesNegative) === true);
  const allExpanded = eventGroups.every((g, i) => isExpanded(g.key, i));
  const toggleGroup = (key: string, index: number) =>
    setExpandedOverride((prev) => ({ ...prev, [key]: !isExpanded(key, index) }));
  const toggleAll = () =>
    setExpandedOverride(Object.fromEntries(eventGroups.map((g) => [g.key, !allExpanded])));

  const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`;

  return (
    <section className="pg forecast-page">
      <div className="pg-hero">
        <div>
          <span className="pg-kicker">Solde liquide dans {HORIZONS.find((h) => h.value === horizon)?.label ?? `${horizon} jours`}</span>
          <strong className={`pg-hero-value ${forecast.endingBalance < 0 ? 'expense' : ''}`}>{money(forecast.endingBalance)}</strong>
          <p className="pg-hero-sub">
            Aujourd’hui <strong>{money(forecast.startingBalance)}</strong> · flux net <strong className={netFlow < 0 ? 'expense' : 'income'}>{signed(netFlow)}</strong>
          </p>
        </div>
        <div className="pg-toolbar-actions">
          <select value={horizon} onChange={(e) => setHorizon(e.target.value)} aria-label="Horizon de projection">
            {HORIZONS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
          <Link className="secondary pg-link-btn" to="/recurring">Récurrents <ArrowRight size={14} /></Link>
        </div>
      </div>

      <div className="pg-stats">
        <div className="pg-stat">
          <span>Point bas</span>
          <strong className={goesNegative ? 'expense' : undefined}>{money(forecast.lowestBalance)}</strong>
          <small>{forecast.lowestDate ? formatRelativeDate(forecast.lowestDate).label : 'Jamais sous le départ'}</small>
        </div>
        <div className="pg-stat">
          <span>Entrées</span>
          <strong className={forecast.totalIncome > 0 ? 'income' : undefined}>{forecast.totalIncome > 0 ? '+' : ''}{money(forecast.totalIncome)}</strong>
        </div>
        <div className="pg-stat">
          <span>Sorties</span>
          <strong className={forecast.totalExpenses > 0 ? 'expense' : undefined}>{forecast.totalExpenses > 0 ? '−' : ''}{money(forecast.totalExpenses)}</strong>
        </div>
        <div className="pg-stat">
          <span>Échéances</span>
          <strong>{forecast.events.length}</strong>
          <small>{shortDate(forecast.from)} → {shortDate(forecast.to)}</small>
        </div>
      </div>

      {goesNegative && forecast.lowestDate && (
        <div className="pg-alert" role="status">
          <AlertTriangle size={16} />
          <span>Ton solde liquide passerait sous zéro le {formatRelativeDate(forecast.lowestDate).label} ({money(forecast.lowestBalance)}).</span>
        </div>
      )}

      <div className="pg-card">
        <div className="pg-card-head"><h2>Trajectoire</h2></div>
        <div className="pg-card-body">
          <div className="pg-chart">
            {forecast.series.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartTheme.net} stopOpacity={0.28} />
                      <stop offset="95%" stopColor={chartTheme.net} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={narrow ? 36 : 24} tick={chartTheme.tick} />
                  <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={narrow ? 52 : 70} tick={chartTheme.tick} />
                  <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(label) => `Le ${label}`} contentStyle={chartTheme.tooltip.contentStyle} labelStyle={chartTheme.tooltip.labelStyle} itemStyle={chartTheme.tooltip.itemStyle} cursor={{ stroke: chartTheme.axis, strokeDasharray: '3 3' }} />
                  <ReferenceLine y={0} stroke={chartTheme.expense} strokeDasharray="4 4" />
                  <Area type="stepAfter" dataKey="balance" name="Solde projeté" stroke={chartTheme.net} strokeWidth={2} fill="url(#forecastFill)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Aucun récurrent actif à projeter." />
            )}
          </div>
          <p className="pg-note">Projection des récurrents actifs sur tes comptes courants et d’épargne réglementée — hors dépenses variables.</p>
        </div>
      </div>

      <div className="pg-card">
        <div className="pg-card-head">
          <h2>Échéances à venir</h2>
          {eventGroups.length > 1 && (
            <button type="button" className="ghost-button" onClick={toggleAll}>
              {allExpanded ? 'Tout replier' : 'Tout déplier'}
            </button>
          )}
        </div>
        {forecast.events.length === 0 ? (
          <p className="pg-empty">Aucune échéance récurrente sur cette période.</p>
        ) : eventGroups.map((group, groupIndex) => {
          const open = isExpanded(group.key, groupIndex);
          return (
            <div className="pg-group" key={group.key}>
              <button type="button" className="pg-group-head" onClick={() => toggleGroup(group.key, groupIndex)} aria-expanded={open}>
                <span className="pg-group-title">
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {group.label} <small>{group.events.length}</small>
                </span>
                <strong className={group.endBalance < 0 ? 'expense' : undefined}>
                  {money(group.endBalance)} <small className={group.net < 0 ? 'expense' : 'income'}>{signed(group.net)}</small>
                </strong>
              </button>
              {open && (
                <ul className="lrows">
                  {group.events.map((event, index) => {
                    const account = event.accountId != null ? accountById.get(event.accountId) : null;
                    const category = event.categoryId != null ? categoryById.get(event.categoryId) : null;
                    const meta = [account?.name, category?.name].filter(Boolean).join(' · ');
                    return (
                      <li className="lrow two" key={`${event.recurringId}-${event.date}-${index}`}>
                        <div className="lrow-main">
                          <div className="lrow-title">
                            <Link className="lrow-link" to="/recurring" title="Gérer ce récurrent">{event.description}</Link>
                          </div>
                          <span className="lrow-sub">{formatRelativeDate(event.date).label}{meta && ` · ${meta}`}</span>
                        </div>
                        <div className="lrow-amount">
                          <span className={event.type === 'income' ? 'income' : 'expense'}>{event.type === 'income' ? '+' : '−'}{money(event.amount)}</span>
                          <small className={event.runningBalance < 0 ? 'expense' : undefined}>solde {money(event.runningBalance)}</small>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {forecast.goalDeadlines.length > 0 && (
        <div className="pg-card">
          <div className="pg-card-head">
            <h2>Objectifs à échéance</h2>
            <Link className="panel-link" to="/goals">Voir <ArrowRight size={14} /></Link>
          </div>
          <ul className="lrows">
            {forecast.goalDeadlines.map((goal) => (
              <li className="lrow two" key={goal.goalId}>
                <div className="lrow-main">
                  <div className="lrow-title"><span>{goal.name}</span></div>
                  <span className="lrow-sub">{formatRelativeDate(goal.deadline).label}</span>
                </div>
                <div className="lrow-amount">
                  {goal.remaining > 0 ? money(goal.remaining) : <span className="income">Atteint</span>}
                  {goal.remaining > 0 && <small>à épargner</small>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
