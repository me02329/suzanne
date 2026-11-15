import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  blendedRate, doublingYears, projectWealth, TYPICAL_RETURNS,
  type Account, type AllocationTarget, type AssetBucket, type DashboardSummary, type Institution,
} from '@suzanne/shared';
import { api } from '../../lib/api';
import { usePyramid } from '../../lib/usePyramid';
import { parseDecimal } from '../../lib/pea';
import { useChartTheme } from '../../lib/chartTheme';
import { localeTag } from '../../i18n';

// Simulateur → Mon patrimoine : projection de la répartition réelle (pyramide),
// chaque classe à son rendement typique (modifiable), l'épargne mensuelle
// répartie selon l'allocation cible (ou la répartition actuelle), avec un
// scénario « + X €/mois en actions ».

// Clés écrites en toutes lettres (vérifiées par i18n:check).
const BUCKET_TEXT: Record<AssetBucket, string> = {
  cash: 'analyses.diversification.bucket_cash',
  bonds: 'analyses.diversification.bucket_bonds',
  equities: 'analyses.diversification.bucket_equities',
  real_estate: 'analyses.diversification.bucket_real_estate',
  alternative: 'analyses.diversification.bucket_alternative',
};
const BUCKETS: AssetBucket[] = ['cash', 'bonds', 'equities', 'real_estate', 'alternative'];

export function PyramidProjection({ userId, accounts, institutions, summary, reportCurrency, fmt }: {
  userId: number;
  accounts: Account[];
  institutions: Institution[];
  summary: DashboardSummary | null;
  reportCurrency: string;
  fmt: (v: number) => string;
}) {
  const { t } = useTranslation();
  const chartTheme = useChartTheme();
  const { pyramid } = usePyramid(userId, accounts, institutions, summary, reportCurrency);
  const [target, setTarget] = useState<AllocationTarget | null>(null);
  const [rates, setRates] = useState<Record<AssetBucket, string>>(() => Object.fromEntries(BUCKETS.map((b) => [b, (Math.round(TYPICAL_RETURNS[b] * 1000) / 10).toLocaleString(localeTag())])) as Record<AssetBucket, string>);
  const [monthlyRaw, setMonthlyRaw] = useState<string | null>(null);
  const [yearsRaw, setYearsRaw] = useState('20');
  const [extraRaw, setExtraRaw] = useState('200');

  useEffect(() => {
    let cancelled = false;
    api.allocationTarget(userId).then((v) => { if (!cancelled) setTarget(v); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [userId]);

  // Épargne mensuelle actuelle : (revenus − dépenses) moyens sur 12 mois.
  const pace = useMemo(() => {
    const rows = summary?.monthly_cashflow ?? [];
    return rows.length > 0 ? Math.max(0, rows.reduce((s, m) => s + m.income - m.expenses, 0) / rows.length) : 0;
  }, [summary]);
  const monthly = monthlyRaw == null ? Math.round(pace / 10) * 10 : Math.max(0, parseDecimal(monthlyRaw) || 0);
  const years = Math.max(1, Math.min(50, Math.round(parseDecimal(yearsRaw) || 20)));
  const extra = Math.max(0, parseDecimal(extraRaw) || 0);
  const rateValues = Object.fromEntries(BUCKETS.map((b) => [b, (parseDecimal(rates[b]) || 0) / 100])) as Record<AssetBucket, number>;

  const start = useMemo(() => Object.fromEntries(BUCKETS.map((b) => [b, pyramid?.buckets.find((x) => x.bucket === b)?.amount ?? 0])) as Record<AssetBucket, number>, [pyramid]);
  const split = target ?? start;
  const base = useMemo(() => projectWealth({ start, rates: rateValues, monthly, split, years }), [start, rateValues, monthly, split, years]);
  const scenario = useMemo(() => (extra > 0 ? projectWealth({ start, rates: rateValues, monthly, split, years, extraEquities: extra }) : null), [start, rateValues, monthly, split, years, extra]);

  if (!pyramid) return <p className="acc-muted">{t('analyses.projection.loading')}</p>;
  const blended = blendedRate(start, rateValues);
  const doubling = doublingYears(blended);
  const final = base[base.length - 1]!;
  const milestones = base.filter((y) => y.year > 0 && (y.year % 5 === 0 || y.year === years));
  const chart = base.map((y, i) => ({ year: y.year, total: y.total, contributed: y.contributed, scenario: scenario?.[i]?.total }));
  const pct = (v: number) => `${(v * 100).toLocaleString(localeTag(), { maximumFractionDigits: 1 })} %`;

  return (
    <div className="pg-stack pp">
      <div className="pp-inputs">
        <label><span>{t('analyses.projection.monthly')}</span><input inputMode="decimal" value={monthlyRaw ?? String(monthly)} onChange={(e) => setMonthlyRaw(e.target.value)} /><small className="acc-muted">{t('analyses.projection.monthly_hint', { amount: fmt(pace) })}</small></label>
        <label><span>{t('analyses.projection.years')}</span><input inputMode="numeric" value={yearsRaw} onChange={(e) => setYearsRaw(e.target.value)} /></label>
        <label><span>{t('analyses.projection.extra')}</span><input inputMode="decimal" value={extraRaw} onChange={(e) => setExtraRaw(e.target.value)} /></label>
      </div>
      <p className="acc-muted pp-split">{target ? t('analyses.projection.split_target') : t('analyses.projection.split_current')}</p>

      <div className="kpis">
        <div className="kpi"><span>{t('analyses.projection.today')}</span><strong>{fmt(base[0]!.total)}</strong><small>{t('analyses.projection.blended', { pct: pct(blended) })}</small></div>
        <div className="kpi"><span>{t('analyses.projection.in_years', { years })}</span><strong className="income">{fmt(final.total)}</strong><small>{t('analyses.projection.contributed', { amount: fmt(final.contributed) })}</small></div>
        {scenario && <div className="kpi"><span>{t('analyses.projection.with_extra', { amount: fmt(extra) })}</span><strong className="income">{fmt(scenario[scenario.length - 1]!.total)}</strong><small>{t('analyses.projection.difference', { amount: fmt(scenario[scenario.length - 1]!.total - final.total) })}</small></div>}
        <div className="kpi"><span>{t('analyses.projection.rule_72')}</span><strong>{doubling == null ? '—' : t('analyses.projection.doubling', { years: Math.round(doubling) })}</strong><small>{t('analyses.projection.rule_72_hint')}</small></div>
      </div>

      <div className="pp-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="year" tick={{ fill: chartTheme.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v: number) => `${Math.round(v / 1000)} k`} tick={{ fill: chartTheme.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
            <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(y) => t('analyses.projection.year_n', { n: y })} contentStyle={chartTheme.tooltip.contentStyle} labelStyle={chartTheme.tooltip.labelStyle} itemStyle={chartTheme.tooltip.itemStyle} />
            {scenario && <Area type="monotone" dataKey="scenario" name={t('analyses.projection.with_extra', { amount: fmt(extra) })} stroke={chartTheme.income} fill={chartTheme.income} fillOpacity={0.08} strokeDasharray="4 4" isAnimationActive={false} />}
            <Area type="monotone" dataKey="total" name={t('analyses.projection.total')} stroke={chartTheme.total} fill={chartTheme.total} fillOpacity={0.12} isAnimationActive={false} />
            <Area type="monotone" dataKey="contributed" name={t('analyses.projection.contributed_label')} stroke={chartTheme.axis} fill="transparent" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <section className="pg-section">
        <div className="pg-section-head"><h2>{t('analyses.projection.by_class')}</h2></div>
        <div className="pp-table-wrap">
          <table className="pp-table">
            <thead>
              <tr>
                <th>{t('analyses.projection.class')}</th>
                <th className="num">{t('analyses.projection.rate')}</th>
                <th className="num">{t('analyses.projection.today')}</th>
                {milestones.map((m) => <th key={m.year} className="num">{t('analyses.projection.year_n', { n: m.year })}</th>)}
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map((b) => (
                <tr key={b}>
                  <td>{t(BUCKET_TEXT[b])}</td>
                  <td className="num"><input className="pp-rate" inputMode="decimal" value={rates[b]} onChange={(e) => setRates({ ...rates, [b]: e.target.value })} aria-label={t('analyses.projection.rate')} /> %</td>
                  <td className="num">{fmt(base[0]!.byBucket[b])}</td>
                  {milestones.map((m) => <td key={m.year} className="num">{fmt(m.byBucket[b])}</td>)}
                </tr>
              ))}
              <tr className="pp-total">
                <td>{t('analyses.projection.total')}</td><td />
                <td className="num">{fmt(base[0]!.total)}</td>
                {milestones.map((m) => <td key={m.year} className="num">{fmt(m.total)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p className="acc-muted pp-note">{t('analyses.projection.note')}</p>
    </div>
  );
}
