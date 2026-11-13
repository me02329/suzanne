import type { Prisma } from '@prisma/client';

// Mouvement d'espèces d'un ordre de bourse : une opération `kind = trade` à une
// ligne sur le compte de la position. Achat = sortie (quantité × cours + frais),
// vente = entrée (quantité × cours − frais). N'existe que si le compte a
// `orders_affect_cash` ; sinon l'ordre ne touche que la quantité de titres (ancien
// comportement, conservé pour ne pas modifier les soldes déjà saisis).
//
// Les montants restent en devise du compte : si la position est cotée dans une
// autre devise, le cours est supposé déjà converti (cas PEA : tout en EUR).

type Tx = Prisma.TransactionClient;

export function orderCashAmount(order: { side: string; quantity: number; unit_price: number; fee: number }): number {
  const gross = order.quantity * order.unit_price;
  return Math.round((order.side === 'buy' ? -(gross + order.fee) : gross - order.fee) * 100) / 100;
}

function describe(order: { side: string; quantity: number }, holding: { symbol: string; name: string }): string {
  const qty = Number(order.quantity.toFixed(8)).toString().replace('.', ',');
  return `${order.side === 'buy' ? 'Achat' : 'Vente'} ${qty} × ${holding.name || holding.symbol}`;
}

/** (Re)crée ou supprime le mouvement d'espèces lié à l'ordre `orderId`. */
export async function syncOrderCash(tx: Tx, orderId: number): Promise<void> {
  const order = await tx.holdingOrder.findUnique({
    where: { id: orderId },
    include: { holding: { include: { account: { select: { id: true, orders_affect_cash: true } } } } },
  });
  if (!order) return;
  const { holding } = order;
  if (!holding.account.orders_affect_cash) {
    if (order.cash_transaction_id != null) {
      await tx.holdingOrder.update({ where: { id: order.id }, data: { cash_transaction_id: null } });
      await tx.transaction.delete({ where: { id: order.cash_transaction_id } }).catch(() => undefined);
    }
    return;
  }
  const amount = orderCashAmount(order);
  const data = {
    date: order.date,
    description: describe(order, holding),
    lines: { create: [{ user_id: order.user_id, account_id: holding.account_id, category_id: null, amount }] },
  };
  if (order.cash_transaction_id != null) {
    await tx.transactionLine.deleteMany({ where: { transaction_id: order.cash_transaction_id } });
    await tx.transaction.update({ where: { id: order.cash_transaction_id }, data: { ...data, deleted_at: null } });
    return;
  }
  const created = await tx.transaction.create({ data: { user_id: order.user_id, kind: 'trade', cleared: true, ...data } });
  await tx.holdingOrder.update({ where: { id: order.id }, data: { cash_transaction_id: created.id } });
}

/** Supprime les mouvements d'espèces des ordres donnés (avant leur suppression). */
export async function deleteOrdersCash(tx: Tx, where: Prisma.HoldingOrderWhereInput): Promise<void> {
  const orders = await tx.holdingOrder.findMany({ where: { ...where, cash_transaction_id: { not: null } }, select: { cash_transaction_id: true } });
  const ids = orders.map((o) => o.cash_transaction_id!).filter((id) => id != null);
  if (ids.length > 0) await tx.transaction.deleteMany({ where: { id: { in: ids }, kind: 'trade' } });
}

/** Active/désactive l'effet des ordres sur les espèces d'un compte (rétroactif). */
export async function resyncAccountOrders(tx: Tx, accountId: number): Promise<number> {
  const orders = await tx.holdingOrder.findMany({ where: { holding: { account_id: accountId } }, select: { id: true } });
  for (const o of orders) await syncOrderCash(tx, o.id);
  return orders.length;
}
