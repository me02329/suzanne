import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createBudgetSchema, idParam, monthString } from '../lib/validation.js';

export const budgetsRouter = Router();

budgetsRouter.get('/users/:user_id/budgets', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = req.query.month ? monthString.parse(req.query.month) : undefined;
  if (month) await ensureRecurringBudgets(user_id, month);
  res.json(await prisma.budget.findMany({ where: { user_id, ...(month ? { month } : {}) }, orderBy: { id: 'asc' } }));
}));

budgetsRouter.post('/users/:user_id/budgets', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createBudgetSchema.parse(req.body);
  const row = await prisma.budget.upsert({
    where: { user_id_category_id_month: { user_id, category_id: body.category_id, month: body.month } },
    create: { ...body, user_id },
    update: { amount_limit: body.amount_limit, recurring: body.recurring },
  });
  res.json(row);
}));

budgetsRouter.delete('/users/:user_id/budgets/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.budget.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));

async function ensureRecurringBudgets(user_id: number, month: string): Promise<void> {
  const [existingForMonth, recurringSources] = await Promise.all([
    prisma.budget.findMany({ where: { user_id, month }, select: { category_id: true } }),
    prisma.budget.findMany({
      where: { user_id, recurring: true, month: { lt: month } },
      orderBy: [{ month: 'desc' }, { id: 'desc' }],
    }),
  ]);
  const existingCategoryIds = new Set(existingForMonth.map((budget) => budget.category_id));
  const latestByCategory = new Map<number, typeof recurringSources[number]>();
  for (const budget of recurringSources) {
    if (!latestByCategory.has(budget.category_id)) latestByCategory.set(budget.category_id, budget);
  }
  const toCreate = Array.from(latestByCategory.values())
    .filter((budget) => !existingCategoryIds.has(budget.category_id))
    .map((budget) => ({
      user_id,
      category_id: budget.category_id,
      month,
      amount_limit: budget.amount_limit,
      recurring: true,
    }));
  if (toCreate.length > 0) await prisma.budget.createMany({ data: toCreate });
}
