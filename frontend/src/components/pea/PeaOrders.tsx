import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildOrderBook, orderBookTotals } from '@suzanne/shared';
import { money } from '../../lib/format';
import { formatDateFr, formatQuantity } from '../../lib/pea';
import type { InsightProps } from './insightTypes';
import { useTranslation } from 'react-i18next';

type Side = 'all' | 'buy' | 'sell';

// Onglet « Ordres » : carnet consolidé du compte (njord : Purchases + Sales),
// filtre par titre et par sens, plus-value réalisée de chaque vente (PRU).
export function PeaOrders({ history, fmt }: InsightProps) {
  const { t } = useTranslation();
  const [holdingId, setHoldingId] = useState<number | 'all'>('all');
  const [side, setSide] = useState<Side>('all');
  const book = useMemo(() => buildOrderBook(history.holdings), [history.holdings]);
  const rows = book.filter((r) => (holdingId === 'all' || r.holdingId === holdingId) && (side === 'all' || r.side === side));
  const totals = orderBookTotals(rows);
  const [limit, setLimit] = useState(30);

  if (history.status === 'loading' && book.length === 0) return <p className="acc-muted">{t('patrimoine.pea_orders.loading_orders')}</p>;
  if (book.length === 0) {
    return <p className="acc-muted">{t('patrimoine.pea_orders.no_orders_on_this_account')} <Link to="/investments">{t('patrimoine.pea_orders.enter_order_in_investments')}</Link></p>;
  }

  return (
    <div className="pi">
      <div className="pi-filters">
        <label className="pi-select">
          <span>{t('patrimoine.pea_orders.security')}</span>
          <select value={holdingId} onChange={(e) => setHoldingId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">{t('patrimoine.pea_orders.all_securities')}</option>
            {history.holdings.map((h) => <option key={h.id} value={h.id}>{h.name || h.symbol} ({h.symbol})</option>)}
          </select>
        </label>
        <div className="acc-seg" role="group" aria-label={t('patrimoine.pea_orders.side')}>
          {([['all', 'Tous'], ['buy', 'Achats'], ['sell', 'Ventes']] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={side === v} onClick={() => setSide(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span>{t('patrimoine.pea_orders.buys')}</span><strong>{fmt(totals.buys)}</strong><small>{totals.buyCount}  {t('patrimoine.pea_orders.order')}{totals.buyCount > 1 ? 's' : ''}</small></div>
        <div className="kpi"><span>{t('patrimoine.pea_orders.sells')}</span><strong>{fmt(totals.sells)}</strong><small>{totals.sellCount}  {t('patrimoine.pea_orders.order')}{totals.sellCount > 1 ? 's' : ''}</small></div>
        <div className="kpi"><span>{t('patrimoine.pea_orders.fees')}</span><strong>{fmt(totals.fees)}</strong><small>{t('patrimoine.pea_orders.brokerage')}</small></div>
        <div className="kpi">
          <span>{t('patrimoine.pea_orders.realised')}</span>
          <strong className={totals.sellCount === 0 ? '' : totals.realizedPnl >= 0 ? 'income' : 'expense'}>
            {totals.sellCount === 0 ? '—' : `${totals.realizedPnl >= 0 ? '+' : '−'}${fmt(Math.abs(totals.realizedPnl))}`}
          </strong>
          <small>{t('patrimoine.pea_orders.at_avg_cost')}</small>
        </div>
      </div>

      {rows.length === 0 ? <p className="acc-muted">{t('patrimoine.pea_orders.no_orders_for_this_filter')}</p> : (
        <ul className="pi-orders">
          {rows.slice(0, limit).map((r) => (
            <li key={r.id}>
              <span className={`pi-side ${r.side}`}>{r.side === 'buy' ? 'Achat' : 'Vente'}</span>
              <div className="pi-order-main">
                <span className="pi-order-title">{r.name || r.symbol}</span>
                <span className="pi-order-meta num">
                  {formatDateFr(r.date)} · {formatQuantity(r.quantity)} × {money(r.unitPrice, r.currency)}{r.fee > 0 ? ` · frais ${money(r.fee, r.currency)}` : ''}
                </span>
              </div>
              <div className="pi-order-amounts">
                <span className="num">{r.side === 'buy' ? '−' : '+'}{money(r.total, r.currency)}</span>
                {r.realizedPnl != null && (
                  <small className={`num ${r.realizedPnl >= 0 ? 'income' : 'expense'}`}>
                    {r.realizedPnl >= 0 ? '+' : '−'}{money(Math.abs(r.realizedPnl), r.currency)}  {t('patrimoine.pea_orders.realised_2')}
                  </small>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit && (
        <button type="button" className="secondary pea-more" onClick={() => setLimit((n) => n + 50)}>{t('patrimoine.pea_orders.show_more')}</button>
      )}
      <p className="pea-foot">{t('patrimoine.pea_orders.realised_gain_net_proceeds_average')} <Link to="/investments">{t('patrimoine.pea_orders.investments')}</Link>.</p>
    </div>
  );
}
