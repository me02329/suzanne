import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildTracking } from '@suzanne/shared';
import { moneyCompact } from '../../lib/format';
import { useChartTheme, useIsNarrow } from '../../lib/chartTheme';
import { formatDateFr, formatPct, parseDecimal, type EnvelopeFlow } from '../../lib/pea';
import { timeAxisProps, timeTooltipLabel } from '../../lib/timeAxis';
import { EmptyChart } from '../EmptyChart';
import type { EnvelopeHistory } from './useEnvelopeHistory';

const HORIZONS = [0, 5, 10, 20, 30] as const;

interface Row {
  date: string;
  deposits?: number;
  gains?: number;
  value?: number;
  projDeposits?: number;
  projGains?: number;
  projValue?: number;
}

// Effet des intérêts composés : ce que tu as versé (empilé) et ce que ces
// versements ont rapporté, semaine après semaine ; en option, la suite au
// rendement et au rythme de versement choisis.
export function PeaGrowth({ history, flows, value, asOf, rate, pace, ccy, fmt }: {
  history: EnvelopeHistory;
  flows: EnvelopeFlow[];
  value: number;
  asOf: string;
  /** Rendement annualisé constaté (XIRR), en fraction ; null si inconnu. */
  rate: number | null;
  /** Versement mensuel récent. */
  pace: number;
  ccy: string;
  fmt: (v: number) => string;
}) {
  const theme = useChartTheme();
  const narrow = useIsNarrow();
  const [years, setYears] = useState<(typeof HORIZONS)[number]>(0);
  // Hypothèse prudente par défaut (≈ moyenne long terme des actions monde) ;
  // le rendement réel, souvent flatteur sur peu d'années, est rappelé à côté.
  const defaultRate = 0.07;
  const [rateRaw, setRateRaw] = useState(() => (defaultRate * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
  const [paceRaw, setPaceRaw] = useState(() => String(Math.round(pace)));
  const projRate = (() => { const n = parseDecimal(rateRaw); return Number.isFinite(n) ? n / 100 : defaultRate; })();
  const projPace = (() => { const n = parseDecimal(paceRaw); return Number.isFinite(n) && n >= 0 ? n : 0; })();

  const tracking = useMemo(() => buildTracking(history.values, flows), [history.values, flows]);
  const last = tracking[tracking.length - 1];
  const deposits = last?.cumulatedDeposits ?? 0;
  const earned = last ? last.value - last.cumulatedDeposits : value - deposits;

  const { rows, final } = useMemo(() => {
    const out: Row[] = tracking.map((t) => ({
      date: t.date,
      deposits: Math.max(0, t.cumulatedDeposits),
      gains: Math.max(0, t.value - t.cumulatedDeposits),
      value: t.value,
    }));
    let finalPoint: { value: number; deposits: number } | null = null;
    if (years > 0 && last) {
      // Jonction : le dernier point réel démarre la projection.
      const lastRow = out[out.length - 1]!;
      lastRow.projValue = last.value;
      lastRow.projDeposits = Math.max(0, last.cumulatedDeposits);
      lastRow.projGains = Math.max(0, last.value - last.cumulatedDeposits);
      const monthly = Math.pow(1 + projRate, 1 / 12) - 1;
      let v = last.value;
      let d = last.cumulatedDeposits;
      const [y0, m0] = asOf.split('-').map(Number);
      for (let k = 1; k <= years * 12; k += 1) {
        v = v * (1 + monthly) + projPace;
        d += projPace;
        const total = m0! - 1 + k;
        const date = `${y0! + Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
        out.push({ date, projValue: v, projDeposits: Math.max(0, d), projGains: Math.max(0, v - d) });
      }
      finalPoint = { value: v, deposits: d };
    }
    return { rows: out, final: finalPoint };
  }, [tracking, years, last, projRate, projPace, asOf]);

  const compact = (v: number) => moneyCompact(v, ccy);
  const axis = timeAxisProps(rows.map((r) => r.date), theme.tick, 'month');

  return (
    <section className="pg-section">
      <div className="pg-section-head">
        <h2>Intérêts composés</h2>
        <div className="acc-seg" role="group" aria-label="Projection">
          {HORIZONS.map((h) => (
            <button key={h} type="button" aria-pressed={years === h} onClick={() => setYears(h)}>
              {h === 0 ? 'Réel' : `+${h} ans`}
            </button>
          ))}
        </div>
      </div>
      <div className="kpis pea-growth-kpis">
        <div className="kpi"><span>Versé (net)</span><strong>{fmt(deposits)}</strong><small>ton effort d’épargne</small></div>
        <div className="kpi">
          <span>Gains accumulés</span>
          <strong className={earned >= 0 ? 'income' : 'expense'}>{earned >= 0 ? '+' : '−'}{fmt(Math.abs(earned))}</strong>
          <small className="num">{deposits > 0 ? formatPct((earned / deposits) * 100) : '—'} du versé</small>
        </div>
        {final ? (
          <>
            <div className="kpi"><span>Dans {years} ans</span><strong>{fmt(final.value)}</strong><small>projection</small></div>
            <div className="kpi">
              <span>dont intérêts</span>
              <strong className="income">{fmt(Math.max(0, final.value - final.deposits))}</strong>
              <small className="num">{final.value > 0 ? formatPct(((final.value - final.deposits) / final.value) * 100, false) : '—'} de la valeur</small>
            </div>
          </>
        ) : (
          <div className="kpi">
            <span>Rendement annualisé</span>
            <strong className={rate == null ? '' : rate >= 0 ? 'income' : 'expense'}>{rate == null ? '—' : formatPct(rate * 100)}</strong>
            <small>XIRR depuis l’ouverture</small>
          </div>
        )}
      </div>
      {years > 0 && (
        <div className="pea-growth-params">
          <label>Rendement annuel (%)<input inputMode="decimal" value={rateRaw} onChange={(e) => setRateRaw(e.target.value)} /></label>
          <label>Versement mensuel ({ccy})<input inputMode="decimal" value={paceRaw} onChange={(e) => setPaceRaw(e.target.value)} /></label>
          <p className="acc-muted">Par défaut : 7 %/an (moyenne long terme des actions) — ton rendement réel depuis l’ouverture est de {rate == null ? '—' : formatPct(rate * 100)}/an — et ton versement mensuel moyen. Capitalisation mensuelle, sans frais ni impôt.</p>
        </div>
      )}
      <div className="pi-chart">
        {rows.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="date" {...axis} minTickGap={narrow ? 28 : 36} />
              <YAxis tickFormatter={(v) => compact(Number(v))} tick={theme.tick} tickLine={false} axisLine={false} width={58} />
              <Tooltip
                {...theme.tooltip}
                labelFormatter={timeTooltipLabel('day')}
                formatter={(v, name) => [fmt(Number(v)), name]}
              />
              <Area dataKey="deposits" name="Versé" stackId="real" type="stepAfter" stroke={theme.total} strokeWidth={1.25} fill={theme.total} fillOpacity={0.12} dot={false} isAnimationActive={false} />
              <Area dataKey="gains" name="Gains" stackId="real" type="monotone" stroke={theme.income} strokeWidth={0} fill={theme.income} fillOpacity={0.35} dot={false} isAnimationActive={false} />
              <Line dataKey="value" name="Valeur" type="monotone" stroke={theme.net} strokeWidth={2} dot={false} isAnimationActive={false} />
              {years > 0 && (
                <>
                  <Area dataKey="projDeposits" name="Versé (projeté)" stackId="proj" type="linear" stroke={theme.total} strokeDasharray="4 3" strokeWidth={1} fill={theme.total} fillOpacity={0.06} dot={false} isAnimationActive={false} />
                  <Area dataKey="projGains" name="Intérêts (projetés)" stackId="proj" type="monotone" stroke="none" fill={theme.income} fillOpacity={0.18} dot={false} isAnimationActive={false} />
                  <Line dataKey="projValue" name="Valeur (projetée)" type="monotone" stroke={theme.net} strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message={history.status === 'loading' || history.status === 'idle' ? 'Valorisation de l’historique…' : 'Pas assez d’historique.'} />
        )}
      </div>
      <p className="acc-muted pea-growth-foot">
        Zone verte = ce que tes versements ont rapporté (valeur − versé). {last ? `Au ${formatDateFr(last.date)}.` : ''}
      </p>
    </section>
  );
}
