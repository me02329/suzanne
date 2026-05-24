import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createTransactionSchema, idParam, monthString } from '../lib/validation.js';

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
  const row = await prisma.transaction.create({
    data: {
      user_id,
      account_id: body.account_id ?? null,
      category_id: body.category_id ?? null,
      amount: body.amount,
      type: body.type,
      date: new Date(body.date),
      description: body.description ?? null,
    },
  });
  res.status(201).json(row);
}));

transactionsRouter.delete('/transactions/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await prisma.transaction.delete({ where: { id } });
  res.json({ deleted: true });
}));

function nextMonth(month: string): string {
  const [yearRaw, monthRaw] = month.split('-');
  const date = new Date(Date.UTC(Number(yearRaw), Number(monthRaw), 1));
  return date.toISOString();
}
