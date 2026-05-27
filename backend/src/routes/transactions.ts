import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createTransactionSchema, idParam, linkRecurringSchema, monthString, updateTransactionSchema } from '../lib/validation.js';
import { fetchExchangeRate } from '../lib/fx.js';
import { round2 } from '../lib/money.js';

export const transactionsRouter = Router();

transactionsRouter.get('/users/:user_id/transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = req.query.month ? monthString.parse(req.query.month) : null;
  const where = month
    ? { user_id, date: { gte: new Date(`${month}-01T00:00:00.000Z`), lt: new Date(nextMonth(month)) } }
    : { user_id };
  const rows = await prisma.transaction.findMany({ where, orderBy: [{ date: 'desc' }, { id: 'desc' }] });
  res.json(rows);
}));

transactionsRouter.post('/users/:user_id/transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createTransactionSchema.parse(req.body);
  const transfer = await transferAmounts(user_id, body);
  const row = await prisma.transaction.create({
    data: {
      user_id,
      account_id: body.account_id ?? null,
      to_account_id: body.type === 'transfer' ? body.to_account_id ?? null : null,
      category_id: body.category_id ?? null,
      amount: body.amount,
      to_amount: transfer.toAmount,
      exchange_rate: transfer.exchangeRate,
      type: body.type,
      date: new Date(body.date),
      description: body.description ?? null,
    },
  });
  res.status(201).json(row);
}));

transactionsRouter.patch('/users/:user_id/transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateTransactionSchema.parse(req.body);
  const existing = await prisma.transaction.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const next = {
    type: body.type ?? existing.type,
    account_id: body.account_id !== undefined ? body.account_id ?? null : existing.account_id,
    to_account_id: body.to_account_id !== undefined ? body.to_account_id ?? null : existing.to_account_id,
    amount: body.amount ?? existing.amount,
    to_amount: body.to_amount !== undefined ? body.to_amount ?? null : existing.to_amount,
    date: body.date ?? existing.date.toISOString().slice(0, 10),
  };
  const transfer = await transferAmounts(user_id, next);
  const row = await prisma.transaction.update({
    where: { id },
    data: {
      ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
      ...(body.to_account_id !== undefined ? { to_account_id: body.to_account_id ?? null } : {}),
      ...(body.category_id !== undefined ? { category_id: body.category_id ?? null } : {}),
      ...(body.amount != null ? { amount: body.amount } : {}),
      to_amount: transfer.toAmount,
      exchange_rate: transfer.exchangeRate,
      ...(body.type != null ? { type: body.type } : {}),
      ...(body.date != null ? { date: new Date(body.date) } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    },
  });
  res.json(row);
}));

transactionsRouter.post('/users/:user_id/transactions/:id/link-recurring', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = linkRecurringSchema.parse(req.body);
  const existing = await prisma.transaction.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (body.recurring_transaction_id == null) {
    const row = await prisma.transaction.update({ where: { id }, data: { recurring_transaction_id: null } });
    res.json(row);
    return;
  }
  const recurring = await prisma.recurringTransaction.findFirst({
    where: { id: body.recurring_transaction_id, user_id },
  });
  if (!recurring) {
    res.status(404).json({ error: 'Recurring transaction not found' });
    return;
  }
  const data = {
    recurring_transaction_id: recurring.id,
    ...(body.sync_description ? { description: recurring.description } : {}),
    ...(body.sync_amount ? { amount: recurring.amount } : {}),
    ...(body.sync_category_account ? {
      account_id: recurring.account_id,
      category_id: recurring.category_id,
      type: recurring.type,
      to_account_id: null,
      to_amount: null,
      exchange_rate: null,
    } : {}),
  };
  const row = await prisma.transaction.update({ where: { id }, data });
  res.json(row);
}));

transactionsRouter.delete('/users/:user_id/transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.transaction.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));

function nextMonth(month: string): string {
  const [yearRaw, monthRaw] = month.split('-');
  const date = new Date(Date.UTC(Number(yearRaw), Number(monthRaw), 1));
  return date.toISOString();
}

async function transferAmounts(
  userId: number,
  body: { type?: string; account_id?: number | null; to_account_id?: number | null; amount: number; to_amount?: number | null; date: string },
): Promise<{ toAmount: number | null; exchangeRate: number | null }> {
  if (body.type !== 'transfer' || !body.account_id || !body.to_account_id) return { toAmount: null, exchangeRate: null };
  if (body.to_amount != null) return { toAmount: body.to_amount, exchangeRate: round2(body.to_amount / body.amount) };

  const [from, to] = await Promise.all([
    prisma.account.findFirst({ where: { id: body.account_id, user_id: userId } }),
    prisma.account.findFirst({ where: { id: body.to_account_id, user_id: userId } }),
  ]);
  if (!from || !to) return { toAmount: body.amount, exchangeRate: 1 };
  const quote = await fetchExchangeRate(from.currency, to.currency, body.date);
  return { toAmount: round2(body.amount * quote.rate), exchangeRate: quote.rate };
}
