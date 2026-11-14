import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  annualizedTwr,
  buildTracking,
  compareWithBenchmark,
  maxDrawdown,
  monthlyReturns,
  periodReturn,
  trackingToFlowPoints,
  twrIndex,
  type PricePoint,
} from '@suzanne/shared';
import { moneyCompact } from '../../lib/format';
import { useChartTheme } from '../../lib/chartTheme';
import { usePersistedState } from '../../lib/storage';
import { pricesApi } from '../../lib/api-pea';
import { formatDateFr, formatPct } from '../../lib/pea';
import { EmptyChart } from '../EmptyChart';
import type { InsightProps } from './insightTypes';
import { localeTag } from '../../i18n';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTHS_LONG = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const tone = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'income' : 'expense');

// Fond d'une case de la heatmap : intensité proportionnelle à |r| (plafonnée à 6 %).
function heat(r: number | null): CSSProperties | undefined {
  if (r == null) return undefined;
  const pct = Math.round(Math.min(1, Math.abs(r) / 6) * 42 + 6);
  return { background: `color-mix(in srgb, var(${r >= 0 ? '--income' : '--expense'}) ${pct}%, transparent)` };
}

// Onglet « Performance » : TWR (versements neutralisés), heatmap mensuelle,
// drawdown, comparaison à un indice (njord : PerfHeatmap, analytics, benchmark).
export function PeaPerformance({ flows, history, currentValue, asOf, ccy, fmt }: InsightProps) {
  const theme = useChartTheme();
  const rows = useMemo(() => buildTracking(history.values, flows), [history.values, flows]);
  const index = useMemo(() => twrIndex(trackingToFlowPoints(rows)), [rows]);
  const dd = useMemo(() => maxDrawdown(index), [index]);
  const monthly = useMemo(() => monthlyReturns(index), [index]);
  const cumulative = index.length > 1 ? (index[index.length - 1]!.index - 1) * 100 : null;
  const annualized = annualizedTwr(index);

  const years = useMemo(() => {
    const ys = [...new Set(monthly.map((m) => m.year))].sort((a, b) => b - a);
    return ys.map((y) => {
      const cells: Array<number | null> = Array(12).fill(null);
      for (const m of monthly) if (m.year === y) cells[m.month - 1] = m.returnPct;
      const yr = periodReturn(index, `${y - 1}-12-31`, `${y}-12-31`);
      return { year: y, cells, total: yr.returnPct, partial: yr.partial };
    });
  }, [monthly, index]);

  if (history.status !== 'ready' && rows.length === 0) {
    return <p className="acc-muted">{history.status === 'error' ? 'Historique indisponible.' : 'Valorisation de l’historique…'}</p>;
  }
  if (index.length < 2) return <p className="acc-muted">Pas encore assez d’historique pour mesurer la performance.</p>;

  const chart = index.map((p) => ({ date: p.date, base: p.index * 100 }));

  return (
    <div className="pi">
      <div className="pi-hero">
        <span className="acc-kicker">Performance depuis le {formatDateFr(index[0]!.date)}</span>
        <strong className={`pi-hero-value num ${tone(cumulative)}`}>{formatPct(cumulative)}</strong>
        <span className="acc-muted">pondérée par le temps : les versements et retraits ne comptent pas comme des gains.</span>
      </div>
      <div className="kpis">
        <div className="kpi"><span>Annualisée</span><strong className={tone(annualized)}>{formatPct(annualized)}</strong><small>{annualized == null ? 'moins d’un an' : 'TWR par an'}</small></div>
        <div className="kpi">
          <span>Baisse maximale</span>
          <strong className={dd.maxDrawdownPct > 0 ? 'expense' : ''}>{dd.maxDrawdownPct > 0 ? formatPct(-dd.maxDrawdownPct) : '0 %'}</strong>
          <small>{dd.peakDate && dd.troughDate ? `${formatDateFr(dd.peakDate, { month: 'short', year: 'numeric' })} → ${formatDateFr(dd.troughDate, { month: 'short', year: 'numeric' })}` : 'aucune'}</small>
        </div>
        <div className="kpi">
          <span>Rétablie</span>
          <strong>{dd.maxDrawdownPct === 0 ? '—' : dd.recoveryDate ? formatDateFr(dd.recoveryDate, { month: 'short', year: 'numeric' }) : 'Pas encore'}</strong>
          <small>retour au plus haut</small>
        </div>
        <div className="kpi">
          <span>Sous le plus haut</span>
          <strong className={dd.currentDrawdownPct > 0.05 ? 'expense' : ''}>{dd.currentDrawdownPct > 0.05 ? formatPct(-dd.currentDrawdownPct) : 'Au plus haut'}</strong>
          <small>aujourd’hui</small>
        </div>
      </div>

      <section className="pg-section">
        <div className="pg-section-head"><h2>Indice de performance</h2><span className="acc-muted">base 100</span></div>
        <div className="pi-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => formatDateFr(String(d), { month: 'short', year: '2-digit' })} tick={theme.tick} tickLine={false} axisLine={false} minTickGap={32} />
              <YAxis domain={['auto', 'auto']} tickFormatter={(v) => Number(v).toFixed(0)} tick={theme.tick} tickLine={false} axisLine={false} width={40} />
              <Tooltip {...theme.tooltip} labelFormatter={(d) => formatDateFr(String(d))} formatter={(v) => [Number(v).toFixed(1), 'Indice']} />
              <Line dataKey="base" type="monotone" stroke={theme.net} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="pg-section">
        <div className="pg-section-head"><h2>Performance mensuelle</h2></div>
        <div className="pi-heat" role="table" aria-label="Performance mensuelle">
          <div className="pi-heat-row pi-heat-head" role="row">
            <span role="columnheader" />
            {MONTHS.map((m, i) => <span key={i} role="columnheader" title={MONTHS_LONG[i]}>{m}</span>)}
            <span role="columnheader">Année</span>
          </div>
          {years.map((y) => (
            <div key={y.year} className="pi-heat-row" role="row">
              <span className="pi-heat-year" role="rowheader">{y.year}</span>
              {y.cells.map((r, i) => (
                <span key={i} role="cell" className="pi-heat-cell num" style={heat(r)} title={`${MONTHS_LONG[i]} ${y.year}`}>
                  <small>{MONTHS_LONG[i]}</small>
                  {r == null ? '' : (r >= 0 ? '+' : '−') + Math.abs(r).toLocaleString(localeTag(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}
                </span>
              ))}
              <span role="cell" className={`pi-heat-total num ${tone(y.total)}`}>{formatPct(y.total)}{y.partial && <small> partiel</small>}</span>
            </div>
          ))}
        </div>
        <p className="pea-foot">En %, sur l’indice pondéré par le temps (cours du vendredi).</p>
      </section>

      <Benchmark flows={flows} values={history.values} currentValue={currentValue} asOf={asOf} ccy={ccy} fmt={fmt} />
    </div>
  );
}

function Benchmark({ flows, values, currentValue, asOf, ccy, fmt }: Pick<InsightProps, 'flows' | 'currentValue' | 'asOf' | 'ccy' | 'fmt'> & { values: Array<{ date: string; value: number }> }) {
  const theme = useChartTheme();
  const [symbol, setSymbol] = usePersistedState('pea_benchmark_symbol', 'CW8.PA');
  const [draft, setDraft] = useState(symbol);
  const [prices, setPrices] = useState<PricePoint[] | null | 'error'>(null);
  const first = flows.length > 0 ? flows[flows.length - 1]!.date : null;

  useEffect(() => {
    if (!first) return;
    let cancelled = false;
    setPrices(null);
    pricesApi.history(symbol, first, asOf)
      .then((p) => { if (!cancelled) setPrices(p); })
      .catch(() => { if (!cancelled) setPrices('error'); });
    return () => { cancelled = true; };
  }, [symbol, first, asOf]);

  const result = useMemo(
    () => (Array.isArray(prices) ? compareWithBenchmark({ flows, history: prices, values, currentValue, asOf }) : null),
    [prices, flows, values, currentValue, asOf],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = draft.trim().toUpperCase();
    if (s) setSymbol(s);
  };

  const diff = result ? result.portfolio.value - result.benchmark.value : 0;

  return (
    <section className="pg-section">
      <div className="pg-section-head">
        <h2>Face à un indice</h2>
        <form className="pi-bench-form" onSubmit={submit}>
          <input aria-label="Symbole de l’indice (Yahoo)" value={draft} onChange={(e) => setDraft(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          <button type="submit" className="secondary">Comparer</button>
        </form>
      </div>
      {!first ? <p className="acc-muted">Aucun versement à comparer.</p>
        : prices === null ? <p className="acc-muted">Chargement des cours de {symbol}…</p>
          : prices === 'error' || !result ? <p className="acc-muted">Cours de {symbol} indisponibles.</p>
            : (
              <>
                <p className="pi-bench-lead">
                  Si chaque versement avait acheté <b>{symbol}</b> le jour même, tu aurais{' '}
                  <b className="num">{fmt(result.benchmark.value)}</b> au lieu de <b className="num">{fmt(result.portfolio.value)}</b> :{' '}
                  <b className={`num ${tone(diff)}`}>{diff >= 0 ? '+' : '−'}{fmt(Math.abs(diff))}</b> {diff >= 0 ? 'en ta faveur' : 'pour l’indice'}.
                </p>
                <div className="pi-bench">
                  {([['Ton enveloppe', result.portfolio], [symbol, result.benchmark]] as const).map(([label, side]) => (
                    <dl key={label} className="pea-dl pi-bench-side">
                      <div className="pea-total"><dt>{label}</dt><dd className="num">{fmt(side.value)}</dd></div>
                      <div><dt>Gain</dt><dd className={`num ${tone(side.gain)}`}>{side.gain >= 0 ? '+' : '−'}{fmt(Math.abs(side.gain))} <small>{formatPct(side.gainPct)}</small></dd></div>
                      <div><dt>Rendement annualisé</dt><dd className="num">{formatPct(side.xirr)}</dd></div>
                    </dl>
                  ))}
                </div>
                <div className="pi-chart">
                  {result.series.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={result.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={theme.grid} vertical={false} />
                        <XAxis dataKey="date" tickFormatter={(d) => formatDateFr(String(d), { month: 'short', year: '2-digit' })} tick={theme.tick} tickLine={false} axisLine={false} minTickGap={32} />
                        <YAxis tickFormatter={(v) => moneyCompact(Number(v), ccy)} tick={theme.tick} tickLine={false} axisLine={false} width={56} />
                        <Tooltip {...theme.tooltip} labelFormatter={(d) => formatDateFr(String(d))} formatter={(v, name) => [fmt(Number(v)), name]} />
                        <Line dataKey="portfolio" name="Ton enveloppe" stroke={theme.net} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line dataKey="benchmark" name={symbol} stroke={theme.series[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line dataKey="contributed" name="Versé" type="stepAfter" stroke={theme.axis} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <EmptyChart />}
                </div>
                <p className="pea-foot">
                  Même capital des deux côtés : {fmt(result.capital)} depuis le {formatDateFr(result.start)}.
                  {result.absorbedFlows > 0 && ` Les ${result.absorbedFlows} versements antérieurs à l’historique de ${symbol} sont repris via la valeur de l’enveloppe à cette date (${fmt(result.startValue)}), des deux côtés.`}
                  {' '}Cours en devise de cotation, sans frais.
                </p>
              </>
            )}
    </section>
  );
}
