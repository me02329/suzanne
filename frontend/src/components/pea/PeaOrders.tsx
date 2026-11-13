import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildOrderBook, orderBookTotals } from '@suzanne/shared';
import { money } from '../../lib/format';
import { formatDateFr, formatQuantity } from '../../lib/pea';
import type { InsightProps } from './insightTypes';

type Side = 'all' | 'buy' | 'sell';

// Onglet « Ordres » : carnet consolidé du compte (njord : Purchases + Sales),
// filtre par titre et par sens, plus-value réalisée de chaque vente (PRU).
export function PeaOrders({ history, fmt }: InsightProps) {
  const [holdingId, setHoldingId] = useState<number | 'all'>('all');
  const [side, setSide] = useState<Side>('all');
  const book = useMemo(() => buildOrderBook(history.holdings), [history.holdings]);
  const rows = book.filter((r) => (holdingId === 'all' || r.holdingId === holdingId) && (side === 'all' || r.side === side));
  const totals = orderBookTotals(rows);
  const [limit, setLimit] = useState(30);

  if (history.status === 'loading' && book.length === 0) return <p className="acc-muted">Chargement des ordres…</p>;
  if (book.length === 0) {
    return <p className="acc-muted">Aucun ordre sur ce compte. <Link to="/investments">Saisir un ordre dans Placements</Link></p>;
  }

  return (
    <div className="pi">
      <div className="pi-filters">
        <label className="pi-select">
          <span>Titre</span>
          <select value={holdingId} onChange={(e) => setHoldingId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">Tous les titres</option>
            {history.holdings.map((h) => <option key={h.id} value={h.id}>{h.name || h.symbol} ({h.symbol})</option>)}
          </select>
        </label>
        <div className="acc-seg" role="group" aria-label="Sens">
          {([['all', 'Tous'], ['buy', 'Achats'], ['sell', 'Ventes']] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={side === v} onClick={() => setSide(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span>Achats</span><strong>{fmt(totals.buys)}</strong><small>{totals.buyCount} ordre{totals.buyCount > 1 ? 's' : ''}</small></div>
        <div className="kpi"><span>Ventes</span><strong>{fmt(totals.sells)}</strong><small>{totals.sellCount} ordre{totals.sellCount > 1 ? 's' : ''}</small></div>
        <div className="kpi"><span>Frais</span><strong>{fmt(totals.fees)}</strong><small>courtage</small></div>
        <div className="kpi">
          <span>+/- réalisée</span>
          <strong className={totals.sellCount === 0 ? '' : totals.realizedPnl >= 0 ? 'income' : 'expense'}>
            {totals.sellCount === 0 ? '—' : `${totals.realizedPnl >= 0 ? '+' : '−'}${fmt(Math.abs(totals.realizedPnl))}`}
          </strong>
          <small>au PRU</small>
        </div>
      </div>

      {rows.length === 0 ? <p className="acc-muted">Aucun ordre pour ce filtre.</p> : (
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
                    {r.realizedPnl >= 0 ? '+' : '−'}{money(Math.abs(r.realizedPnl), r.currency)} réalisé
                  </small>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit && (
        <button type="button" className="secondary pea-more" onClick={() => setLimit((n) => n + 50)}>Afficher plus</button>
      )}
      <p className="pea-foot">Plus-value réalisée = produit net − prix de revient moyen (frais d’achat inclus) × quantité vendue. Pour saisir ou corriger un ordre : <Link to="/investments">Placements</Link>.</p>
    </div>
  );
}
