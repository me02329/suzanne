import { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { availableYears, buildOrderBook, buildTracking, buildYearRecap, trackingToFlowPoints, twrIndex } from '@suzanne/shared';
import { formatPct } from '../../lib/pea';
import type { InsightProps } from './insightTypes';
import { useTranslation } from 'react-i18next';

const tone = (v: number | null) => (v == null ? '' : v >= 0 ? 'income' : 'expense');

// Onglet « Récap » : bilan d'une année, imprimable (njord : page Recap).
export function PeaRecap({ account, flows, incomes, history, asOf, fmt }: InsightProps) {
  const { t } = useTranslation();
  const orders = useMemo(() => buildOrderBook(history.holdings), [history.holdings]);
  const rows = useMemo(() => buildTracking(history.values, flows), [history.values, flows]);
  const index = useMemo(() => twrIndex(trackingToFlowPoints(rows)), [rows]);
  const years = useMemo(
    () => availableYears([...flows.map((f) => f.date), ...orders.map((o) => o.date), ...incomes.map((f) => f.date), ...history.values.map((v) => v.date)]),
    [flows, orders, incomes, history.values],
  );
  const [picked, setPicked] = useState<number | null>(null);
  const year = picked != null && years.includes(picked) ? picked : years[0] ?? null;
  const recap = useMemo(
    () => (year == null ? null : buildYearRecap({ year, flows, orders, incomes, values: history.values, index, asOf })),
    [year, flows, orders, incomes, history.values, index, asOf],
  );

  if (history.status === 'loading' && history.values.length === 0) return <p className="acc-muted">{t('patrimoine.pea_recap.preparing_summary')}</p>;
  if (!recap || year == null) return <p className="acc-muted">{t('patrimoine.pea_recap.nothing_to_summarise_yet')}</p>;
  const current = String(year) === asOf.slice(0, 4);
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`;

  return (
    <div className="pi pi-recap">
      <div className="pi-filters pi-noprint">
        <div className="acc-seg pi-years" role="group" aria-label={t('patrimoine.pea_recap.year')}>
          {years.slice(0, 6).map((y) => <button key={y} type="button" aria-pressed={y === year} onClick={() => setPicked(y)}>{y}</button>)}
        </div>
        <button type="button" className="secondary" onClick={() => window.print()}><Printer size={16} />  {t('patrimoine.pea_recap.print')}</button>
      </div>

      <article className="pi-recap-sheet">
        <header className="pi-hero">
          <span className="acc-kicker">{account.name}  {t('patrimoine.pea_recap.summary')} {year}{current ? ' (en cours)' : ''}</span>
          <strong className={`pi-hero-value num ${tone(recap.twrPct)}`}>{formatPct(recap.twrPct)}</strong>
          <span className="acc-muted">
            
            {t('patrimoine.pea_recap.performance_for_year_deposits_neutralise')}{recap.partial ? ' — depuis le premier versement' : ''}.
          </span>
        </header>

        <div className="kpis">
          <div className="kpi"><span>{t('patrimoine.pea_recap.paid_in')}</span><strong>{fmt(recap.deposits)}</strong><small>{recap.depositCount}  {t('patrimoine.pea_recap.deposit')}{recap.depositCount > 1 ? 's' : ''}</small></div>
          <div className="kpi"><span>{t('patrimoine.pea_recap.gain_for_year')}</span><strong className={tone(recap.gain)}>{recap.gain == null ? '—' : signed(recap.gain)}</strong><small>{t('patrimoine.pea_recap.excluding_deposits')}</small></div>
          <div className="kpi"><span>{t('patrimoine.pea_recap.realised')}</span><strong className={recap.sellCount ? tone(recap.realizedPnl) : ''}>{recap.sellCount ? signed(recap.realizedPnl) : '—'}</strong><small>{recap.sellCount}  {t('patrimoine.pea_recap.sale')}{recap.sellCount > 1 ? 's' : ''}</small></div>
          <div className="kpi"><span>{t('patrimoine.pea_recap.income')}</span><strong className={recap.income > 0 ? 'income' : ''}>{recap.income > 0 ? fmt(recap.income) : '—'}</strong><small>{t('patrimoine.pea_recap.dividends_coupons')}</small></div>
        </div>

        <div className="pea-grid">
          <section className="pea-card">
            <h2>{t('patrimoine.pea_recap.value')}</h2>
            <dl className="pea-dl">
              <div><dt>{t('patrimoine.pea_recap.on_1_january')}</dt><dd className="num">{recap.startValue == null ? '—' : fmt(recap.startValue)}</dd></div>
              <div><dt>{t('patrimoine.pea_recap.net_deposits')}</dt><dd className="num">{signed(recap.netDeposits)}</dd></div>
              {recap.withdrawals > 0 && <div><dt>{t('patrimoine.pea_recap.incl_withdrawals')}</dt><dd className="num">−{fmt(recap.withdrawals)}</dd></div>}
              <div><dt>{t('patrimoine.pea_recap.gain')}</dt><dd className={`num ${tone(recap.gain)}`}>{recap.gain == null ? '—' : signed(recap.gain)}</dd></div>
              <div className="pea-total"><dt>{current ? 'Aujourd’hui' : 'Au 31 décembre'}</dt><dd className="num">{recap.endValue == null ? '—' : fmt(recap.endValue)}</dd></div>
            </dl>
          </section>
          <section className="pea-card">
            <h2>{t('patrimoine.pea_recap.orders')}</h2>
            <dl className="pea-dl">
              <div><dt>{t('patrimoine.pea_recap.buys')}{recap.buyCount})</dt><dd className="num">{fmt(recap.buys)}</dd></div>
              <div><dt>{t('patrimoine.pea_recap.sells')}{recap.sellCount})</dt><dd className="num">{fmt(recap.sells)}</dd></div>
              <div><dt>{t('patrimoine.pea_recap.fees')}</dt><dd className="num">{fmt(recap.fees)}</dd></div>
              <div className="pea-total"><dt>{t('patrimoine.pea_recap.realised')}</dt><dd className={`num ${recap.sellCount ? tone(recap.realizedPnl) : ''}`}>{recap.sellCount ? signed(recap.realizedPnl) : '—'}</dd></div>
            </dl>
          </section>
        </div>

        {recap.byHolding.length > 0 && (
          <section className="pg-section">
            <div className="pg-section-head"><h2>{t('patrimoine.pea_recap.by_security')}</h2></div>
            <ul className="pi-orders">
              {recap.byHolding.map((h) => (
                <li key={h.symbol}>
                  <div className="pi-order-main"><span className="pi-order-title">{h.name || h.symbol}</span><span className="pi-order-meta">{h.symbol}</span></div>
                  <div className="pi-order-amounts">
                    <span className="num">{h.buys > 0 ? `${fmt(h.buys)} achetés` : ''}{h.buys > 0 && h.sells > 0 ? ' · ' : ''}{h.sells > 0 ? `${fmt(h.sells)} vendus` : ''}</span>
                    {h.sells > 0 && <small className={`num ${tone(h.realizedPnl)}`}>{signed(h.realizedPnl)}  {t('patrimoine.pea_recap.realised_2')}</small>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}
