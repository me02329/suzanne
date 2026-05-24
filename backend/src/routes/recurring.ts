import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createRecurringSchema, idParam, updateRecurringSchema } from '../lib/validation.js';

export const recurringRouter = Router();

recurringRouter.get('/users/:user_id/recurring-transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.recurringTransaction.findMany({
    where: { user_id },
    orderBy: [{ active: 'desc' }, { id: 'desc' }],
  }));
}));

recurringRouter.post('/users/:user_id/recurring-transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createRecurringSchema.parse(req.body);
  const row = await prisma.recurringTransaction.create({
    data: {
      user_id,
      account_id: body.account_id ?? null,
      category_id: body.category_id ?? null,
      amount: body.amount,
      type: body.type,
      description: body.description,
      frequency: body.frequency,
      day_of_month: body.day_of_month ?? null,
      active: body.active,
    },
  });
  res.status(201).json(row);
}));

recurringRouter.patch('/recurring-transactions/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const body = updateRecurringSchema.parse(req.body);
  const row = await prisma.recurringTransaction.update({
    where: { id },
    data: {
      ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
      ...(body.category_id !== undefined ? { category_id: body.category_id ?? null } : {}),
      ...(body.amount != null ? { amount: body.amount } : {}),
      ...(body.type != null ? { type: body.type } : {}),
      ...(body.description != null ? { description: body.description } : {}),
      ...(body.frequency != null ? { frequency: body.frequency } : {}),
      ...(body.day_of_month !== undefined ? { day_of_month: body.day_of_month ?? null } : {}),
      ...(body.active != null ? { active: body.active } : {}),
    },
  });
  res.json(row);
}));

recurringRouter.delete('/recurring-transactions/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await prisma.recurringTransaction.delete({ where: { id } });
  res.json({ deleted: true });
}));

recurringRouter.post('/users/:user_id/recurring-transactions/generate', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const today = new Date();
  const generated = await generateDueRecurringTransactions(user_id, today);
  res.json({ generated });
}));

async function generateDueRecurringTransactions(user_id: number, today: Date): Promise<number> {
  const rows = await prisma.recurringTransaction.findMany({ where: { user_id, active: true } });
  let generated = 0;

  for (const row of rows) {
    const dueDates = dueDatesFor(row.frequency, row.day_of_month, row.last_executed, today);
    for (const date of dueDates) {
      await prisma.transaction.create({
        data: {
          user_id,
          account_id: row.account_id,
          category_id: row.category_id,
          amount: row.amount,
          type: row.type,
          date,
          description: row.description,
        },
      });
      generated += 1;
    }
    if (dueDates.length > 0) {
      await prisma.recurringTransaction.update({
        where: { id: row.id },
        data: { last_executed: dueDates[dueDates.length - 1] },
      });
    }
  }

  return generated;
}

function dueDatesFor(frequency: string, dayOfMonth: number | null, lastExecuted: Date | null, today: Date): Date[] {
  if (frequency !== 'monthly') return [];
  const dates: Date[] = [];
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const due = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(dayOfMonth ?? 1, daysInMonth(cursor))));
  const lastKey = lastExecuted ? dateKey(lastExecuted) : null;
  if (due <= today && (!lastKey || dateKey(due) > lastKey)) dates.push(due);
  return dates;
}

function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function dateKey(date: Date): string {
  return date.toISOString().split('T')[0]!;
}
