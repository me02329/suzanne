import { HttpError } from '../middleware/errors.js';
// Logique de position pure (testée, sans I/O) : à partir du carnet d'ordres
// d'une position on déduit la quantité détenue, le prix de revient (méthode du
// coût moyen pondéré, PRU) et la plus-value réalisée à une date donnée. La
// valeur de marché et la plus-value latente se calculent ensuite en multipliant
// la quantité par le cours du jour (fourni par marketData).

export interface OrderLike {
  side: 'buy' | 'sell';
  date: Date;
  quantity: number;
  unit_price: number;
  fee: number;
  id?: number;
}

export interface PositionStats {
  quantity: number;     // quantité détenue à la date
  cost_basis: number;   // coût total des titres encore détenus (PRU × quantité)
  avg_cost: number;     // PRU (coût de revient unitaire)
  realized_pnl: number; // plus-value réalisée sur les ventes jusqu'à la date
}

// Coût moyen pondéré : un achat augmente quantité et coût total (frais inclus) ;
// une vente sort les titres au PRU courant (le PRU des titres restants ne bouge
// pas) et matérialise la plus-value réalisée (produit net de frais − coût sorti).
export function positionStats(orders: OrderLike[], asOf?: Date): PositionStats {
  const cutoff = asOf?.getTime() ?? Infinity;
  const ordered = orders
    .filter((o) => o.date.getTime() <= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || (a.id ?? 0) - (b.id ?? 0));

  let qty = 0;
  let cost = 0;
  let realized = 0;
  for (const o of ordered) {
    if (o.side === 'buy') {
      cost += o.quantity * o.unit_price + o.fee;
      qty += o.quantity;
    } else {
      const avg = qty > 0 ? cost / qty : 0;
      const sold = Math.min(o.quantity, qty); // on ne vend pas plus que détenu
      const costRemoved = avg * sold;
      realized += (sold * o.unit_price - o.fee) - costRemoved;
      cost -= costRemoved;
      qty -= sold;
    }
  }
  // Quantité résiduelle quasi nulle (arrondis flottants) → on remet à zéro.
  if (Math.abs(qty) < 1e-9) { qty = 0; cost = 0; }
  return {
    quantity: qty,
    cost_basis: cost,
    avg_cost: qty > 0 ? cost / qty : 0,
    realized_pnl: realized,
  };
}

// Rejoue le carnet dans l'ordre chronologique : à aucun moment une vente ne
// doit dépasser la quantité détenue (y compris les ventes postérieures à un
// ordre modifié ou supprimé). Lève une erreur 400 sinon.
export function assertSaleWithinHoldings(orders: Array<Pick<OrderLike, 'side' | 'date' | 'quantity'> & { id?: number }>): void {
  const ordered = [...orders].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.side === 'buy' ? -1 : 1) - (b.side === 'buy' ? -1 : 1));
  let qty = 0;
  for (const o of ordered) {
    qty += o.side === 'buy' ? o.quantity : -o.quantity;
    if (qty < -1e-9) {
      throw new HttpError(400, `Vente supérieure à la quantité détenue au ${o.date.toISOString().slice(0, 10)}`);
    }
  }
}

export interface PositionValue extends PositionStats {
  market_value: number;     // quantité × cours (devise de cotation)
  unrealized_pnl: number;   // market_value − cost_basis
}

// Valorise une position à un cours donné (devise de cotation). price null =
// cours indisponible → valeur de marché = coût (dégrade sans planter).
export function valuePosition(stats: PositionStats, price: number | null): PositionValue {
  const market_value = price != null ? stats.quantity * price : stats.cost_basis;
  return { ...stats, market_value, unrealized_pnl: market_value - stats.cost_basis };
}
