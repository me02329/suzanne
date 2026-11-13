import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma, prismaBase } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import {
  createHoldingOrderSchema,
  createHoldingSchema,
  currencyQuery,
  idParam,
  updateHoldingOrderSchema,
  updateHoldingSchema,
} from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { valueHoldings, type HoldingInput } from '../lib/holdingsValuation.js';
import { deleteOrdersCash, syncOrderCash } from '../lib/holdingCash.js';
import { assertSaleWithinHoldings } from '../lib/holdings.js';

export const holdingsRouter = Router();

const HOLDING_INCLUDE = {
  orders: { orderBy: [{ date: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.HoldingInclude;

type HoldingWithOrders = Prisma.HoldingGetPayload<{ include: typeof HOLDING_INCLUDE }>;

const serializeHolding = (h: HoldingWithOrders) => ({
  ...h,
  orders: h.orders.map((o) => ({ ...o, date: o.date.toISOString().slice(0, 10) })),
});

async function ownHolding(user_id: number, id: number) {
  return prisma.holding.findFirst({ where: { id, user_id }, include: HOLDING_INCLUDE });
}

holdingsRouter.get('/users/:user_id/holdings', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const rows = await prisma.holding.findMany({ where: { user_id }, include: HOLDING_INCLUDE, orderBy: { id: 'desc' } });
  res.json(rows.map(serializeHolding));
}));

// Valorisation au cours du jour : positions détenues, agrégats et allocation par
// classe d'actif, dans la devise de reporting. Alimente la page Patrimoine.
holdingsRouter.get('/users/:user_id/holdings/valuation', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  const rows = await prisma.holding.findMany({ where: { user_id }, include: HOLDING_INCLUDE });
  const valued = await valueHoldings(rows as unknown as HoldingInput[], reportCurrency);

  const market_value = round2(valued.reduce((s, h) => s + h.market_value_report, 0));
  const cost_basis = round2(valued.reduce((s, h) => s + h.cost_basis_report, 0));
  const unrealized_pnl = round2(valued.reduce((s, h) => s + h.unrealized_pnl_report, 0));

  const byClass = new Map<string, number>();
  for (const h of valued) byClass.set(h.asset_class, (byClass.get(h.asset_class) ?? 0) + h.market_value_report);
  const allocation = Array.from(byClass.entries())
    .map(([asset_class, value]) => ({
      asset_class,
      value: round2(value),
      weight: market_value > 0 ? round2((value / market_value) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value);

  res.json({
    currency: reportCurrency,
    market_value,
    cost_basis,
    unrealized_pnl,
    unrealized_pnl_pct: cost_basis > 0 ? round2((unrealized_pnl / cost_basis) * 100) : 0,
    holdings: valued.map((h) => ({
      id: h.id,
      account_id: h.account_id,
      symbol: h.symbol,
      name: h.name,
      asset_class: h.asset_class,
      currency: h.currency,
      quantity: Math.round(h.quantity * 1e8) / 1e8,
      avg_cost: Math.round(h.avg_cost * 1e6) / 1e6,
      price: h.price != null ? Math.round(h.price * 1e6) / 1e6 : null,
      market_value: round2(h.market_value_report),
      cost_basis: round2(h.cost_basis_report),
      unrealized_pnl: round2(h.unrealized_pnl_report),
      realized_pnl: round2(h.realized_pnl),
      weight: market_value > 0 ? round2((h.market_value_report / market_value) * 100) : 0,
    })),
    allocation,
  });
}));

holdingsRouter.post('/users/:user_id/holdings', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createHoldingSchema.parse(req.body);
  const account = await prisma.account.findFirst({ where: { id: body.account_id, user_id } });
  if (!account) {
    res.status(400).json({ error: 'Compte introuvable pour cet utilisateur' });
    return;
  }
  const row = await prisma.holding.create({
    data: {
      user_id,
      account_id: body.account_id,
      symbol: body.symbol.toUpperCase(),
      name: body.name,
      asset_class: body.asset_class,
      currency: body.currency,
    },
    include: HOLDING_INCLUDE,
  });
  res.status(201).json(serializeHolding(row));
}));

holdingsRouter.patch('/users/:user_id/holdings/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateHoldingSchema.parse(req.body);
  const existing = await prisma.holding.findFirst({ where: { id, user_id }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Position introuvable' });
    return;
  }
  const row = await prisma.holding.update({
    where: { id },
    data: {
      ...(body.symbol != null ? { symbol: body.symbol.toUpperCase() } : {}),
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.asset_class != null ? { asset_class: body.asset_class } : {}),
      ...(body.currency != null ? { currency: body.currency } : {}),
    },
    include: HOLDING_INCLUDE,
  });
  res.json(serializeHolding(row));
}));

holdingsRouter.delete('/users/:user_id/holdings/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prismaBase.$transaction(async (tx) => {
    await deleteOrdersCash(tx, { holding_id: id, user_id });
    return tx.holding.deleteMany({ where: { id, user_id } });
  });
  if (result.count === 0) {
    res.status(404).json({ error: 'Position introuvable' });
    return;
  }
  res.json({ deleted: true });
}));

holdingsRouter.post('/users/:user_id/holdings/:id/orders', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = createHoldingOrderSchema.parse(req.body);
  const holding = await prisma.holding.findFirst({ where: { id, user_id }, include: { orders: true } });
  if (!holding) {
    res.status(404).json({ error: 'Position introuvable' });
    return;
  }
  const candidate = { side: body.side, date: new Date(body.date), quantity: body.quantity, unit_price: body.unit_price, fee: body.fee };
  assertSaleWithinHoldings([...holding.orders, candidate]);
  await prismaBase.$transaction(async (tx) => {
    const order = await tx.holdingOrder.create({ data: { user_id, holding_id: id, ...candidate } });
    await syncOrderCash(tx, order.id);
  });
  res.status(201).json(serializeHolding((await ownHolding(user_id, id))!));
}));

holdingsRouter.patch('/users/:user_id/holdings/:id/orders/:order_id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const order_id = idParam.parse(req.params.order_id);
  const body = updateHoldingOrderSchema.parse(req.body);
  const order = await prisma.holdingOrder.findFirst({ where: { id: order_id, holding_id: id, user_id } });
  if (!order) {
    res.status(404).json({ error: 'Ordre introuvable' });
    return;
  }
  const next = {
    side: body.side ?? order.side,
    date: body.date != null ? new Date(body.date) : order.date,
    quantity: body.quantity ?? order.quantity,
    unit_price: body.unit_price ?? order.unit_price,
    fee: body.fee ?? order.fee,
  };
  const siblings = await prisma.holdingOrder.findMany({ where: { holding_id: id, id: { not: order_id } } });
  assertSaleWithinHoldings([...siblings, next]);
  await prismaBase.$transaction(async (tx) => {
    await tx.holdingOrder.update({ where: { id: order_id }, data: next });
    await syncOrderCash(tx, order_id);
  });
  res.json(serializeHolding((await ownHolding(user_id, id))!));
}));

holdingsRouter.delete('/users/:user_id/holdings/:id/orders/:order_id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const order_id = idParam.parse(req.params.order_id);
  const remaining = await prisma.holdingOrder.findMany({ where: { holding_id: id, id: { not: order_id } } });
  // Supprimer un achat ne doit pas rendre une vente ultérieure impossible.
  assertSaleWithinHoldings(remaining);
  const result = await prismaBase.$transaction(async (tx) => {
    await deleteOrdersCash(tx, { id: order_id, holding_id: id, user_id });
    return tx.holdingOrder.deleteMany({ where: { id: order_id, holding_id: id, user_id } });
  });
  if (result.count === 0) {
    res.status(404).json({ error: 'Ordre introuvable' });
    return;
  }
  res.json(serializeHolding((await ownHolding(user_id, id))!));
}));
