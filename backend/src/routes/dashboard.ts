import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { idParam, monthString } from '../lib/validation.js';

export const dashboardRouter = Router();

dashboardRouter.get('/users/:user_id/dashboard', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

  const [transactions, accounts, categories] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id, date: { gte: start, lt: end } } }),
    prisma.account.findMany({ where: { user_id } }),
    prisma.category.findMany({ where: { user_id } }),
  ]);

  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const allTransactions = await prisma.transaction.findMany({ where: { user_id } });
  const initial = accounts.reduce((s, a) => s + a.initial_balance, 0);
  const balance = allTransactions.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), initial);

  const byCategory = new Map<number | null, number>();
  for (const t of transactions.filter((t) => t.type === 'expense')) byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + t.amount);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  res.json({
    month,
    income,
    expenses,
    net: income - expenses,
    balance,
    expenses_by_category: Array.from(byCategory.entries()).map(([category_id, amount]) => {
      const category = category_id ? categoryById.get(category_id) : null;
      return { category_id, name: category?.name ?? 'Sans catégorie', color: category?.color ?? '#9ca3af', amount };
    }),
  });
}));
