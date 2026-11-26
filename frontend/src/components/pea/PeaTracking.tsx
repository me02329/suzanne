import { useMemo, useState } from 'react';
import { timeAxisProps } from '../../lib/timeAxis';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildTracking, monthlyFlows } from '@suzanne/shared';
import { moneyCompact } from '../../lib/format';
import { useChartTheme, useIsNarrow } from '../../lib/chartTheme';
import { formatDateFr, formatPct } from '../../lib/pea';
import { EmptyChart } from '../EmptyChart';
import type { InsightProps } from './insightTypes';
import { useTranslation } from 'react-i18next';

const signed = (v: number, fmt: (v: number) => string) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`;
const tone = (v: number | null) => (v == null ? '' : v >= 0 ? 'income' : 'expense');

// Onglet « Suivi » : versements par mois, valeur vs versements, tableau
// hebdomadaire (njord : PaymentsChart, PortfolioChart, WeeklyTrackingTable).
export function PeaTracking({ flows, history, ccy, asOf, fmt }: InsightProps) {
  const { t } = useTranslation();
  const theme = useChartTheme();
  const narrow = useIsNarrow();
  const [showAll, setShowAll] = useState(false);
  const months = useMemo(() => monthlyFlows(flows, asOf), [flows, asOf]);
  const rows = useMemo(() => buildTracking(history.values, flows), [history.values, flows]);
  const compact = (v: number) => moneyCompact(v, ccy);
  const last = rows[rows.length - 1];
  const lastWeek = [...rows].reverse().find((r) => r.change != null && r.date !== asOf) ?? null;
  const recent = [...rows].reverse();
  const visible = showAll ? recent : recent.slice(0, narrow ? 8 : 12);

  const monthLabel = (m: string) => formatDateFr(`${m}-01`, { month: 'short', year: '2-digit' });

  return (
    <div className="pi">
      {last && (
        <div className="kpis">
          <div className="kpi"><span>{t('patrimoine.pea_tracking.value')}</span><strong>{fmt(last.value)}</strong><small>{t('patrimoine.pea_tracking.on')} {formatDateFr(last.date)}</small></div>
          <div className="kpi"><span>{t('patrimoine.pea_tracking.paid_in_net')}</span><strong>{fmt(last.cumulatedDeposits)}</strong><small>{flows.length}  {t('patrimoine.pea_tracking.movement')}{flows.length > 1 ? 's' : ''}</small></div>
          <div className="kpi"><span>{t('patrimoine.pea_tracking.value_2')}</span><strong className={tone(last.gain)}>{signed(last.gain, fmt)}</strong><small className="num">{formatPct(last.gainPct)}</small></div>
          <div className="kpi">
            <span>{t('patrimoine.pea_tracking.last_week')}</span>
            <strong className={tone(lastWeek?.change ?? null)}>{lastWeek?.change != null ? signed(lastWeek.change, fmt) : '—'}</strong>
            <small className="num">{lastWeek ? `${formatPct(lastWeek.changePct)} · hors versements` : 'hors versements'}</small>
          </div>
        </div>
      )}

      <section className="pg-section">
        <div className="pg-section-head"><h2>{t('patrimoine.pea_tracking.deposits_by_month')}</h2></div>
        <div className="pi-chart">
          {months.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={months} margin={{ top: 10, right: 14, left: 2, bottom: 0 }}>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="month" {...timeAxisProps(months.map((m) => m.month), theme.tick, 'month')} minTickGap={24} />
                <YAxis yAxisId="m" tickFormatter={(v) => compact(Number(v))} tick={theme.tick} tickLine={false} axisLine={false} width={56} />
                <YAxis yAxisId="c" orientation="right" hide={narrow} tickFormatter={(v) => compact(Number(v))} tick={theme.tick} tickLine={false} axisLine={false} width={60} />
                <Tooltip {...theme.tooltip} labelFormatter={(m) => formatDateFr(`${String(m)}-01`, { month: 'long', year: 'numeric' })} formatter={(v, name) => [fmt(Number(v)), name]} />
                <Bar yAxisId="m" dataKey="net" name="Versé ce mois" fill={theme.series[1]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="c" dataKey="cumulative" name="Cumul" type="stepAfter" stroke={theme.total} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <EmptyChart message="Aucun versement." />}
        </div>
      </section>

      <section className="pg-section">
        <div className="pg-section-head"><h2>{t('patrimoine.pea_tracking.value_and_deposits')}</h2></div>
        <div className="pi-chart">
          {rows.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 10, right: 20, left: 2, bottom: 0 }}>
                <defs>
                  <linearGradient id="piValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={theme.net} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={theme.net} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => formatDateFr(String(d), { month: 'short', year: '2-digit' })} tick={theme.tick} tickLine={false} axisLine={false} minTickGap={32} padding={{ left: 8, right: 8 }} />
                <YAxis tickFormatter={(v) => compact(Number(v))} tick={theme.tick} tickLine={false} axisLine={false} width={56} />
                <Tooltip {...theme.tooltip} labelFormatter={(d) => formatDateFr(String(d))} formatter={(v, name) => [fmt(Number(v)), name]} />
                <Area dataKey="value" name="Valeur" type="monotone" stroke={theme.net} strokeWidth={2} fill="url(#piValue)" dot={false} isAnimationActive={false} />
                <Line dataKey="cumulatedDeposits" name="Versé" type="stepAfter" stroke={theme.total} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <EmptyChart message={history.status === 'loading' ? 'Valorisation de l’historique…' : 'Pas assez d’historique.'} />}
        </div>
      </section>

      <section className="pg-section">
        <div className="pg-section-head"><h2>{t('patrimoine.pea_tracking.weekly_tracking')}</h2><span className="acc-muted">{t('patrimoine.pea_tracking.friday_prices')}</span></div>
        {rows.length === 0 ? (
          <p className="acc-muted">{history.status === 'loading' ? 'Chargement…' : 'Pas encore de suivi.'}</p>
        ) : (
          <>
            <div className="pea-table-wrap">
              <table className="pea-table pi-week">
                <thead>
                  <tr><th>{t('patrimoine.pea_tracking.week')}</th><th className="r">{t('patrimoine.pea_tracking.value')}</th><th className="r">{t('patrimoine.pea_tracking.cumulative_paid_in')}</th><th className="r">{t('patrimoine.pea_tracking.value_2')}</th><th className="r">{t('patrimoine.pea_tracking.change')}</th></tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.date}>
                      <td className="pea-title"><strong>{r.date === asOf ? 'Aujourd’hui' : formatDateFr(r.date)}</strong>{r.flow !== 0 && <span>{r.flow > 0 ? 'versement ' : 'retrait '}{signed(r.flow, fmt)}</span>}</td>
                      <td className="r num pea-value" data-label={t('patrimoine.pea_tracking.value')}>{fmt(r.value)}</td>
                      <td className="r num" data-label={t('patrimoine.pea_tracking.cumulative_paid_in')}>{fmt(r.cumulatedDeposits)}</td>
                      <td className={`r num ${tone(r.gain)}`} data-label={t('patrimoine.pea_tracking.value_2')}>{signed(r.gain, fmt)} <small>{formatPct(r.gainPct)}</small></td>
                      <td className={`r num ${tone(r.change)}`} data-label={t('patrimoine.pea_tracking.change')}>{r.change == null ? '—' : <>{signed(r.change, fmt)} <small>{formatPct(r.changePct)}</small></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {recent.length > visible.length || showAll ? (
              <button type="button" className="secondary pea-more" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Réduire' : `Voir les ${recent.length} semaines`}
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
