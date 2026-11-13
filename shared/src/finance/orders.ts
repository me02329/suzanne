// Carnet d'ordres consolidé d'un compte (njord : pages Purchases / Sales et
// lib/portfolio.ts buildPositionSummaries). Plus-value réalisée au prix de
// revient unitaire moyen (PRU, frais d'achat inclus), méthode fiscale du PEA/CTO.

export interface OrderInput {
  id: number;
  date: string;
  side: 'buy' | 'sell';
  quantity: number;
  unit_price: number;
  fee: number;
}

export interface HoldingOrdersInput {
  id: number;
  symbol: string;
  name: string;
  currency: string;
  orders: ReadonlyArray<OrderInput>;
}

export interface OrderRow {
  id: number;
  holdingId: number;
  symbol: string;
  name: string;
  currency: string;
  date: string;
  side: 'buy' | 'sell';
  quantity: number;
  unitPrice: number;
  fee: number;
  /** Montant réglé : achat = quantité × cours + frais ; vente = quantité × cours − frais. */
  total: number;
  /** PRU au moment de l'ordre (avant l'ordre). */
  avgCostBefore: number;
  /** Ventes uniquement : produit net − PRU × quantité vendue. */
  realizedPnl: number | null;
  /** Quantité détenue après l'ordre. */
  quantityAfter: number;
}

export function buildOrderBook(holdings: ReadonlyArray<HoldingOrdersInput>): OrderRow[] {
  const rows: OrderRow[] = [];
  for (const h of holdings) {
    let quantity = 0;
    let cost = 0;
    const orders = [...h.orders].sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1) || a.id - b.id);
    for (const o of orders) {
      const avg = quantity > 0 ? cost / quantity : 0;
      const gross = o.quantity * o.unit_price;
      let realized: number | null = null;
      if (o.side === 'buy') {
        quantity += o.quantity;
        cost += gross + o.fee;
      } else {
        const q = Math.min(o.quantity, quantity);
        realized = round2(q * o.unit_price - o.fee - avg * q);
        cost -= avg * q;
        quantity -= q;
        if (quantity <= 1e-9) { quantity = 0; cost = 0; }
      }
      rows.push({
        id: o.id,
        holdingId: h.id,
        symbol: h.symbol,
        name: h.name,
        currency: h.currency,
        date: o.date.slice(0, 10),
        side: o.side,
        quantity: o.quantity,
        unitPrice: o.unit_price,
        fee: o.fee,
        total: round2(o.side === 'buy' ? gross + o.fee : gross - o.fee),
        avgCostBefore: avg,
        realizedPnl: realized,
        quantityAfter: quantity,
      });
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

export interface OrderBookTotals {
  buys: number;
  buyCount: number;
  sells: number;
  sellCount: number;
  fees: number;
  realizedPnl: number;
}

export function orderBookTotals(rows: ReadonlyArray<OrderRow>): OrderBookTotals {
  const t: OrderBookTotals = { buys: 0, buyCount: 0, sells: 0, sellCount: 0, fees: 0, realizedPnl: 0 };
  for (const r of rows) {
    t.fees += r.fee;
    if (r.side === 'buy') { t.buys += r.total; t.buyCount += 1; } else { t.sells += r.total; t.sellCount += 1; t.realizedPnl += r.realizedPnl ?? 0; }
  }
  return { ...t, buys: round2(t.buys), sells: round2(t.sells), fees: round2(t.fees), realizedPnl: round2(t.realizedPnl) };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
