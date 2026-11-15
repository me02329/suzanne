import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { PEA_CEILING, exitTax, simulateCompoundGrowth, type Account, type CompoundResult, type DashboardSummary, type Institution } from '@suzanne/shared';
import { PyramidProjection } from '../components/simulator/PyramidProjection';
import { money, moneyCompact, todayIso } from '../lib/format';
import { seriesColor, useChartTheme, useIsNarrow } from '../lib/chartTheme';
import { usePersistedState } from '../lib/storage';
import { parseDecimal } from '../lib/pea';
import '../styles/pages/accounts.css';
import '../styles/pages/pea.css';
import '../styles/pages/simulator.css';
import { localeTag } from '../i18n';
import { useTranslation } from 'react-i18next';

type Mode = 'simulator' | 'scenarios' | 'wealth';

interface Scenario {
  id: number;
  label: string;
  monthly: string;
  rate: string;
}

const DEFAULT_SCENARIOS: Scenario[] = [
  { id: 1, label: 'Prudent', monthly: '200', rate: '4' },
  { id: 2, label: 'Régulier', monthly: '500', rate: '7' },
  { id: 3, label: 'Ambitieux', monthly: '800', rate: '7' },
];

const num = (raw: string, fallback = 0) => {
  const v = parseDecimal(raw);
  return Number.isFinite(v) ? v : fallback;
};
const clampYears = (raw: string) => Math.max(1, Math.min(60, Math.round(num(raw, 20))));

function simulate(initial: number, monthly: number, rate: number, years: number, pea: boolean, asOf: string) {
  const result = simulateCompoundGrowth({ initialCapital: initial, monthlyDeposit: monthly, annualRatePercent: rate, years, ceiling: pea ? PEA_CEILING : null });
  const tax = exitTax({ total: result.finalTotal, contributed: result.finalContributed, envelope: pea ? 'pea' : 'cto', holdingYears: years, asOf });
  return { result, tax };
}

// Simulateur d'intérêts composés + comparaison de scénarios (njord : pages
// Simulator et Scenarios), avec plafond PEA et net d'impôt à la sortie.
export function Simulator({ userId, accounts, institutions, summary, reportCurrency }: { userId: number; accounts: Account[]; institutions: Institution[]; summary: DashboardSummary | null; reportCurrency: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = usePersistedState<Mode>('simulator_mode', 'simulator');
  const ccy = summary?.currency ?? reportCurrency;
  const fmt = (v: number) => money(v, ccy);
  const peaBalance = (summary?.account_balances ?? []).filter((a) => a.type === 'pea').reduce((s, a) => s + a.signed_balance, 0);

  return (
    <section className="pg-stack sim">
      <div className="acc-seg sim-mode" role="group" aria-label={t('analyses.simulator.mode')}>
        <button type="button" aria-pressed={mode === 'simulator'} onClick={() => setMode('simulator')}>{t('analyses.simulator.simulator')}</button>
        <button type="button" aria-pressed={mode === 'scenarios'} onClick={() => setMode('scenarios')}>{t('analyses.simulator.scenarios')}</button>
        <button type="button" aria-pressed={mode === 'wealth'} onClick={() => setMode('wealth')}>{t('analyses.projection.mode')}</button>
      </div>
      {mode === 'simulator'
        ? <SingleSimulator fmt={fmt} ccy={ccy} peaBalance={peaBalance} />
        : mode === 'scenarios' ? <Scenarios fmt={fmt} ccy={ccy} />
          : <PyramidProjection userId={userId} accounts={accounts} institutions={institutions} summary={summary} reportCurrency={reportCurrency} fmt={fmt} />}
    </section>
  );
}

function Field({ label, value, onChange, suffix, numeric = 'decimal' }: { label: string; value: string; onChange: (v: string) => void; suffix: string; numeric?: 'decimal' | 'numeric' }) {
  return (
    <label className="sim-field">
      <span>{label}</span>
      <span className="sim-input">
        <input inputMode={numeric} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
        <i>{suffix}</i>
      </span>
    </label>
  );
}

function PeaToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <label className="sim-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{t('analyses.simulator.in_pea')} <small>{t('analyses.simulator.deposits_capped_at')} <span className="num">{money(PEA_CEILING, 'EUR')}</span>{t('analyses.simulator.pea_taxation')}</small></span>
    </label>
  );
}

function SingleSimulator({ fmt, ccy, peaBalance }: { fmt: (v: number) => string; ccy: string; peaBalance: number }) {
  const { t } = useTranslation();
  const theme = useChartTheme();
  const narrow = useIsNarrow();
  const asOf = todayIso();
  const [initial, setInitial] = usePersistedState('simulator_initial', '0');
  const [monthly, setMonthly] = usePersistedState('simulator_monthly', '200');
  const [rate, setRate] = usePersistedState('simulator_rate', '7');
  const [yearsRaw, setYears] = usePersistedState('simulator_years', '20');
  const [pea, setPea] = usePersistedState('simulator_pea', true);
  const [showAll, setShowAll] = useState(false);
  const years = clampYears(yearsRaw);
  const { result, tax } = useMemo(
    () => simulate(num(initial), num(monthly), num(rate), years, pea, asOf),
    [initial, monthly, rate, years, pea, asOf],
  );
  const multiplier = result.finalContributed > 0 ? result.finalTotal / result.finalContributed : null;
  const data = result.points.map((p) => ({ year: p.year, contributed: Math.round(p.contributed), interest: Math.round(Math.max(0, p.interest)) }));
  const rows = narrow && !showAll ? result.points.filter((p) => p.year % 5 === 0 || p.year === years) : result.points;

  return (
    <>
      <header className="acc-hero">
        <div className="acc-hero-main">
          <span className="acc-kicker">{t('analyses.simulator.in')} {years}  {t('analyses.simulator.yr')}{years > 1 ? 's' : ''}</span>
          <strong className="acc-hero-value num">{fmt(result.finalTotal)}</strong>
          <span className="acc-hero-sub">
            <span>{t('analyses.simulator.net_tax')} <b className="num">{fmt(tax.net)}</b></span>
            <span>{t('analyses.simulator.paid_in')} <b className="num">{fmt(result.finalContributed)}</b></span>
            {multiplier != null && <span>×<b className="num">{multiplier.toLocaleString(localeTag(), { maximumFractionDigits: 2 })}</b></span>}
          </span>
        </div>
      </header>

      <div className="sim-form">
        <Field label={t('analyses.simulator.starting_capital')} value={initial} onChange={setInitial} suffix={ccy} />
        <Field label={t('analyses.simulator.monthly_deposit')} value={monthly} onChange={setMonthly} suffix={`${ccy}/mois`} />
        <Field label={t('analyses.simulator.annual_return')} value={rate} onChange={setRate} suffix="%/an" />
        <Field label={t('analyses.simulator.duration')} value={yearsRaw} onChange={setYears} suffix="ans" numeric="numeric" />
        <PeaToggle checked={pea} onChange={setPea} />
        {peaBalance > 0 && (
          <button type="button" className="secondary sim-prefill" onClick={() => setInitial(String(Math.round(peaBalance)))}>
            <Wand2 size={16} />  {t('analyses.simulator.start_from_my_pea')}<span className="num">{fmt(peaBalance)}</span>)
          </button>
        )}
      </div>

      <div className="kpis">
        <div className="kpi"><span>{t('analyses.simulator.paid_in')}</span><strong>{fmt(result.finalContributed)}</strong><small>{result.ceilingReachedMonth != null ? t('analyses.simulator.cap_reached_in_year_n', { n: Math.ceil((result.ceilingReachedMonth + 1) / 12) }) : num(monthly) > 0 ? t('analyses.simulator.amount_per_month', { amount: fmt(num(monthly)) }) : t('analyses.simulator.capital_only')}</small></div>
        <div className="kpi"><span>{t('analyses.simulator.interest')}</span><strong className={result.finalInterest >= 0 ? 'income' : 'expense'}>{fmt(result.finalInterest)}</strong><small>{result.finalTotal > 0 ? `${Math.round((result.finalInterest / result.finalTotal) * 100)} % du capital` : '—'}</small></div>
        <div className="kpi">
          <span>{t('analyses.simulator.tax_on_withdrawal')}</span><strong>{fmt(tax.total)}</strong>
          <small>{tax.incomeRate > 0 ? `PFU ${(tax.incomeRate * 100).toLocaleString(localeTag())} % + ` : ''}{t('analyses.simulator.social_charges')} {(tax.socialRate * 100).toLocaleString(localeTag())} %</small>
        </div>
        <div className="kpi"><span>{t('analyses.simulator.net_received')}</span><strong>{fmt(tax.net)}</strong><small>{t('analyses.simulator.full_withdrawal')}</small></div>
      </div>

      <section className="pg-section">
        <div className="pg-section-head"><h2>{t('analyses.simulator.projection')}</h2></div>
        <div className="sim-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="year" tickFormatter={(y) => `${y} a`} tick={theme.tick} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tickFormatter={(v) => moneyCompact(Number(v), ccy)} tick={theme.tick} tickLine={false} axisLine={false} width={60} />
              <Tooltip {...theme.tooltip} labelFormatter={(y) => `Année ${y}`} formatter={(v, name) => [fmt(Number(v)), name]} />
              <Legend wrapperStyle={{ fontSize: 12.5 }} />
              <Area dataKey="contributed" name="Versé" stackId="1" type="monotone" stroke={theme.total} fill={theme.grid} fillOpacity={0.8} isAnimationActive={false} />
              <Area dataKey="interest" name="Intérêts" stackId="1" type="monotone" stroke={theme.series[1]} fill={theme.series[1]} fillOpacity={0.3} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="pg-section">
        <div className="pg-section-head"><h2>{t('analyses.simulator.year_by_year')}</h2></div>
        <div className="pea-table-wrap">
          <table className="pea-table">
            <thead><tr><th>{t('analyses.simulator.year')}</th><th className="r">{t('analyses.simulator.capital')}</th><th className="r">{t('analyses.simulator.paid_in')}</th><th className="r">{t('analyses.simulator.interest')}</th><th className="r">{t('analyses.simulator.interest_share')}</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.year}>
                  <td className="pea-title"><strong>{t('analyses.simulator.year')} {p.year}</strong></td>
                  <td className="r num pea-value" data-label={t('analyses.simulator.capital')}>{fmt(p.total)}</td>
                  <td className="r num" data-label={t('analyses.simulator.paid_in')}>{fmt(p.contributed)}</td>
                  <td className="r num income" data-label={t('analyses.simulator.interest')}>{fmt(p.interest)}</td>
                  <td className="r num" data-label={t('analyses.simulator.interest_share')}>{p.total > 0 ? `${Math.round((p.interest / p.total) * 100)} %` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {narrow && (
          <button type="button" className="secondary pea-more" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Tous les 5 ans' : 'Toutes les années'}</button>
        )}
        <p className="pea-foot">
          
          {t('analyses.simulator.return_compounded_monthly_deposit_at')}
          {pea ? ' (PEA : exonération d’impôt sur le revenu après 5 ans).' : ' (compte-titres : prélèvement forfaitaire unique).'}
        </p>
      </section>
    </>
  );
}

function Scenarios({ fmt, ccy }: { fmt: (v: number) => string; ccy: string }) {
  const { t } = useTranslation();
  const theme = useChartTheme();
  const asOf = todayIso();
  const [initial, setInitial] = usePersistedState('scenarios_initial', '0');
  const [yearsRaw, setYears] = usePersistedState('scenarios_years', '20');
  const [pea, setPea] = usePersistedState('scenarios_pea', true);
  const [scenarios, setScenarios] = usePersistedState<Scenario[]>('scenarios_list', DEFAULT_SCENARIOS);
  const years = clampYears(yearsRaw);

  const results = useMemo(
    () => scenarios.map((s) => ({ scenario: s, ...simulate(num(initial), num(s.monthly), num(s.rate), years, pea, asOf) })),
    [scenarios, initial, years, pea, asOf],
  );
  const best = results.reduce<number>((m, r) => Math.max(m, r.tax.net), 0);

  const update = (id: number, patch: Partial<Scenario>) => setScenarios((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const add = () => setScenarios((list) => {
    const id = Math.max(0, ...list.map((s) => s.id)) + 1;
    return [...list, { id, label: `Scénario ${id}`, monthly: '300', rate: '6' }];
  });
  const remove = (id: number) => setScenarios((list) => (list.length <= 1 ? list : list.filter((s) => s.id !== id)));

  const chart = Array.from({ length: years + 1 }, (_, y) => {
    const row: Record<string, number> = { year: y };
    results.forEach((r) => { row[`s${r.scenario.id}`] = Math.round(r.result.points[y]?.total ?? 0); });
    return row;
  });

  return (
    <>
      <div className="sim-form sim-form-common">
        <Field label={t('analyses.simulator.starting_capital')} value={initial} onChange={setInitial} suffix={ccy} />
        <Field label={t('analyses.simulator.duration')} value={yearsRaw} onChange={setYears} suffix="ans" numeric="numeric" />
        <PeaToggle checked={pea} onChange={setPea} />
      </div>

      <div className="sim-scenarios">
        {results.map(({ scenario, result, tax }, i) => (
          <article key={scenario.id} className="sim-scenario" style={{ borderTopColor: seriesColor(theme, i) }}>
            <div className="sim-scenario-head">
              <input aria-label={t('analyses.simulator.scenario_name')} value={scenario.label} onChange={(e) => update(scenario.id, { label: e.target.value })} />
              <button type="button" className="row-btn" aria-label={`Supprimer ${scenario.label}`} disabled={scenarios.length <= 1} onClick={() => remove(scenario.id)}><Trash2 size={16} /></button>
            </div>
            <div className="sim-scenario-fields">
              <Field label={t('analyses.simulator.monthly')} value={scenario.monthly} onChange={(v) => update(scenario.id, { monthly: v })} suffix={ccy} />
              <Field label={t('analyses.simulator.return')} value={scenario.rate} onChange={(v) => update(scenario.id, { rate: v })} suffix="%" />
            </div>
            <ScenarioResult result={result} net={tax.net} fmt={fmt} best={tax.net === best && results.length > 1} />
          </article>
        ))}
        <button type="button" className="sim-add" onClick={add}><Plus size={18} />  {t('analyses.simulator.add_scenario')}</button>
      </div>

      <section className="pg-section">
        <div className="pg-section-head"><h2>{t('analyses.simulator.comparison_over')} {years}  {t('analyses.simulator.years')}</h2></div>
        <div className="sim-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="year" tickFormatter={(y) => `${y} a`} tick={theme.tick} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tickFormatter={(v) => moneyCompact(Number(v), ccy)} tick={theme.tick} tickLine={false} axisLine={false} width={60} />
              <Tooltip {...theme.tooltip} labelFormatter={(y) => `Année ${y}`} formatter={(v, name) => [fmt(Number(v)), name]} />
              <Legend wrapperStyle={{ fontSize: 12.5 }} />
              {results.map((r, i) => (
                <Line key={r.scenario.id} dataKey={`s${r.scenario.id}`} name={r.scenario.label} stroke={seriesColor(theme, i)} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}

function ScenarioResult({ result, net, fmt, best }: { result: CompoundResult; net: number; fmt: (v: number) => string; best: boolean }) {
  const { t } = useTranslation();
  return (
    <dl className="pea-dl">
      <div className="pea-total"><dt>{t('analyses.simulator.final_capital')}{best && <small>{t('analyses.simulator.the_highest')}</small>}</dt><dd className="num">{fmt(result.finalTotal)}</dd></div>
      <div><dt>{t('analyses.simulator.net_tax')}</dt><dd className="num">{fmt(net)}</dd></div>
      <div><dt>{t('analyses.simulator.paid_in')}{result.ceilingReachedMonth != null && <small title={t('analyses.simulator.beyond_this_monthly_deposits_stop')}>{t('analyses.simulator.cap_reached_in_year_n', { n: Math.ceil((result.ceilingReachedMonth + 1) / 12) })}</small>}</dt><dd className="num">{fmt(result.finalContributed)}</dd></div>
      <div><dt>{t('analyses.simulator.interest')}</dt><dd className="num income">{fmt(result.finalInterest)}</dd></div>
    </dl>
  );
}
