import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createTransactionSchema, idParam, linkRecurringSchema, monthString, updateTransactionSchema } from '../lib/validation.js';
import { fetchExchangeRate } from '../lib/fx.js';
import { round2 } from '../lib/money.js';

export const transactionsRouter = Router();

transactionsRouter.get('/users/:user_id/transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = req.query.month ? monthString.parse(req.query.month) : null;
  const issue = req.query.issue ? z.enum(['unassigned_account']).parse(req.query.issue) : null;
  const where = month
    ? { user_id, date: { gte: new Date(`${month}-01T00:00:00.000Z`), lt: new Date(nextMonth(month)) } }
    : { user_id };
  const rows = await prisma.transaction.findMany({
    where: {
      ...where,
      ...(issue === 'unassigned_account' ? { type: { not: 'transfer' as const }, account_id: null } : {}),
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    include: { tags: { include: { tag: true } } },
  });
  res.json(rows.map(serializeTransaction));
}));

transactionsRouter.post('/users/:user_id/transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createTransactionSchema.parse(req.body);
  const transfer = await transferAmounts(user_id, body);
  const tagIds = await resolveTagIds(user_id, body.tag_ids);
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
      tags: { create: tagIds.map((tag_id) => ({ tag_id })) },
    },
    include: { tags: { include: { tag: true } } },
  });
  res.status(201).json(serializeTransaction(row));
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
  // The create schema validates source != destination via superRefine, but
  // the partial update schema can't (fields may be absent). We re-check on
  // the post-merge state so PATCH can't turn an existing transfer into a
  // self-transfer either.
  if (next.type === 'transfer') {
    if (!next.account_id || !next.to_account_id) {
      res.status(400).json({ error: 'Un transfert exige un compte source et un compte destination' });
      return;
    }
    if (next.account_id === next.to_account_id) {
      res.status(400).json({ error: 'Les comptes source et destination doivent être différents' });
      return;
    }
  }
  const transfer = await transferAmounts(user_id, next);
  if (body.tag_ids !== undefined) {
    const tagIds = await resolveTagIds(user_id, body.tag_ids);
    await prisma.transactionTag.deleteMany({ where: { transaction_id: id } });
    if (tagIds.length > 0) {
      await prisma.transactionTag.createMany({
        data: tagIds.map((tag_id) => ({ transaction_id: id, tag_id })),
      });
    }
  }
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
    include: { tags: { include: { tag: true } } },
  });
  res.json(serializeTransaction(row));
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

async function resolveTagIds(userId: number, tagIds: number[] | undefined): Promise<number[]> {
  if (!tagIds || tagIds.length === 0) return [];
  const unique = Array.from(new Set(tagIds));
  const owned = await prisma.tag.findMany({ where: { id: { in: unique }, user_id: userId } });
  return owned.map((tag) => tag.id);
}

export function serializeTransaction(row: {
  id: number;
  user_id: number;
  account_id: number | null;
  to_account_id: number | null;
  category_id: number | null;
  recurring_transaction_id: number | null;
  amount: number;
  to_amount: number | null;
  exchange_rate: number | null;
  type: string;
  date: Date;
  description: string | null;
  created_at: Date;
  tags: Array<{ tag: { id: number; user_id: number; name: string; color: string; created_at: Date } }>;
}) {
  return {
    ...row,
    tags: row.tags.map((join) => join.tag),
  };
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
