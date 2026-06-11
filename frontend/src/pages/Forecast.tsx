import { Fragment, useMemo, useState } from 'react';
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
import { AlertTriangle, ArrowDownCircle, ArrowRight, ArrowUpCircle, CalendarClock, ChevronDown, ChevronRight, Target, TrendingDown, Wallet } from 'lucide-react';
import type { Account, Category, DashboardSummary, RecurringTransaction, SavingsGoal } from '@suzanne-lite/shared';
import { money as moneyFmt, moneyCompact as moneyCompactFmt, formatRelativeDate } from '../lib/format';
import { useChartTheme } from '../lib/chartTheme';
import { usePersistedState } from '../lib/storage';
import { isLiquidRecurring, liquidBalance } from '../lib/balances';
import { buildForecast, groupForecastEvents } from '../lib/forecast';
import { EmptyChart } from '../components/EmptyChart';
import { DataTable } from '../components/DataTable';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';

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

  return (
    <section className="stack">
      <div className="stats-controls">
        <select value={horizon} onChange={(e) => setHorizon(e.target.value)} aria-label="Horizon de projection">
          {HORIZONS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
        </select>
        <span className="stats-controls-note">
          {new Date(`${forecast.from}T00:00:00`).toLocaleDateString('fr-FR')} → {new Date(`${forecast.to}T00:00:00`).toLocaleDateString('fr-FR')}
          {' · '}{forecast.events.length} échéance{forecast.events.length > 1 ? 's' : ''} à venir
        </span>
        <Link className="panel-link" to="/recurring">Gérer les récurrents <ArrowRight size={14} /></Link>
      </div>

      <section className="stats">
        <Stat icon={<Wallet />} label="Solde liquide de départ" value={money(forecast.startingBalance)} signed={forecast.startingBalance} />
        <Stat icon={<TrendingDown />} label="Solde projeté (fin)" value={money(forecast.endingBalance)} signed={forecast.endingBalance} />
        <Stat
          icon={<AlertTriangle />}
          label="Point bas projeté"
          value={money(forecast.lowestBalance)}
          negative={goesNegative}
          delta={forecast.lowestDate ? formatRelativeDate(forecast.lowestDate).label : 'Aucune baisse sous le départ'}
        />
        <Stat icon={netFlow >= 0 ? <ArrowUpCircle /> : <ArrowDownCircle />} label="Flux net sur la période" value={money(netFlow)} signed={netFlow} />
      </section>

      {goesNegative && forecast.lowestDate && (
        <div className="error">
          <AlertTriangle size={16} /> Le solde liquide projeté passe sous zéro le {formatRelativeDate(forecast.lowestDate).label} ({money(forecast.lowestBalance)}).
        </div>
      )}

      <section className="chart-full">
        <Panel title="Solde liquide projeté" icon={<Wallet />}>
          <div className="chart-area">
            {forecast.series.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartTheme.net} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={chartTheme.net} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickFormatter={(value) => moneyCompact(Number(value))} tickLine={false} axisLine={false} width={70} />
                  <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(label) => `Le ${label}`} />
                  <ReferenceLine y={0} stroke={chartTheme.expense} strokeDasharray="4 4" />
                  <Area type="stepAfter" dataKey="balance" name="Solde projeté" stroke={chartTheme.net} strokeWidth={2} fill="url(#forecastFill)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Aucun récurrent actif à projeter. Ajoute des transactions récurrentes pour alimenter la prévision." />
            )}
          </div>
          <p className="panel-note">
            Projection à partir des <strong>récurrents actifs</strong>, sur le solde liquide (comptes courants + épargne réglementée).
            N'inclut pas les dépenses variables ni les versements ponctuels.
          </p>
        </Panel>
      </section>

      <section className="chart-full">
        <Panel
          title="Échéances à venir"
          icon={<CalendarClock />}
          action={eventGroups.length > 1 ? (
            <button type="button" className="ghost-button" onClick={toggleAll}>
              {allExpanded ? 'Tout replier' : 'Tout déplier'}
            </button>
          ) : undefined}
        >
          <DataTable empty={forecast.events.length === 0 ? 'Aucune échéance récurrente sur cette période.' : null}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Compte</th>
                <th>Catégorie</th>
                <th className="amount-cell">Montant</th>
                <th className="amount-cell">Solde projeté</th>
              </tr>
            </thead>
            <tbody>
              {eventGroups.map((group, groupIndex) => {
                const open = isExpanded(group.key, groupIndex);
                return (
                  <Fragment key={group.key}>
                    <tr
                      className="forecast-group-row"
                      onClick={() => toggleGroup(group.key, groupIndex)}
                      aria-expanded={open}
                    >
                      <td colSpan={4} data-label="Période">
                        <span className="forecast-group-label">
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <strong>{group.label}</strong>
                          <span className="muted">· {group.events.length} échéance{group.events.length > 1 ? 's' : ''}</span>
                        </span>
                      </td>
                      <td className={`amount-cell ${group.net < 0 ? 'expense' : 'income'}`} data-label="Net">
                        {group.net >= 0 ? '+' : ''}{money(group.net)}
                      </td>
                      <td className={`amount-cell ${group.endBalance < 0 ? 'expense' : ''}`} data-label="Solde fin de période">
                        {money(group.endBalance)}
                      </td>
                    </tr>
                    {open && group.events.map((event, index) => {
                      const account = event.accountId != null ? accountById.get(event.accountId) : null;
                      const category = event.categoryId != null ? categoryById.get(event.categoryId) : null;
                      return (
                        <tr key={`${event.recurringId}-${event.date}-${index}`}>
                          <td data-label="Date">{formatRelativeDate(event.date).label}</td>
                          <td data-label="Libellé">
                            <Link className="forecast-event-link" to="/recurring" title="Gérer ce récurrent">
                              <strong>{event.description}</strong>
                            </Link>
                          </td>
                          <td data-label="Compte">{account?.name ?? <span className="muted">—</span>}</td>
                          <td data-label="Catégorie">{category?.name ?? <span className="muted">—</span>}</td>
                          <td className={`amount-cell ${event.type === 'income' ? 'income' : 'expense'}`} data-label="Montant">
                            {event.type === 'income' ? '+' : '-'}{money(event.amount)}
                          </td>
                          <td className={`amount-cell ${event.runningBalance < 0 ? 'expense' : ''}`} data-label="Solde projeté">
                            {money(event.runningBalance)}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </DataTable>
        </Panel>
      </section>

      {forecast.goalDeadlines.length > 0 && (
        <section className="chart-full">
          <Panel
            title="Objectifs arrivant à échéance"
            icon={<Target />}
            action={<Link className="panel-link" to="/goals">Voir <ArrowRight size={14} /></Link>}
          >
            <DataTable empty={null}>
              <thead>
                <tr>
                  <th>Objectif</th>
                  <th>Échéance</th>
                  <th className="amount-cell">Restant à épargner</th>
                </tr>
              </thead>
              <tbody>
                {forecast.goalDeadlines.map((goal) => (
                  <tr key={goal.goalId}>
                    <td data-label="Objectif"><span className="dot inline" style={{ background: goal.color }} /><strong>{goal.name}</strong></td>
                    <td data-label="Échéance">{formatRelativeDate(goal.deadline).label}</td>
                    <td className="amount-cell" data-label="Restant à épargner">{goal.remaining > 0 ? money(goal.remaining) : <span className="income">Atteint</span>}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Panel>
        </section>
      )}
    </section>
  );
}
