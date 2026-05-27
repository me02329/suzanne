import { Router } from 'express';
import { accountTypeLabel, type AccountType } from '@suzanne-lite/shared';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { idParam } from '../lib/validation.js';

export const searchRouter = Router();

const typeLabels: Record<string, string> = { expense: 'Dépense', income: 'Revenu', transfer: 'Transfert' };
const categoryTypeLabels: Record<string, string> = { expense: 'Dépense', income: 'Revenu' };

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
  } catch {
    // Fallback if the currency code is somehow invalid.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

searchRouter.get('/users/:user_id/search', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) {
    res.json([]);
    return;
  }
  const contains = { contains: q, mode: 'insensitive' as const };
  const [transactions, categories, accounts, goals] = await Promise.all([
    prisma.transaction.findMany({
      where: { user_id, description: contains },
      take: 10,
      orderBy: { date: 'desc' },
      include: { account: { select: { currency: true } } },
    }),
    prisma.category.findMany({ where: { user_id, name: contains }, take: 10 }),
    prisma.account.findMany({ where: { user_id, name: contains }, take: 10 }),
    prisma.savingsGoal.findMany({ where: { user_id, name: contains }, take: 10 }),
  ]);
  res.json([
    ...transactions.map((t) => {
      const currency = t.account?.currency ?? 'EUR';
      const signedAmount = t.type === 'expense' ? -t.amount : t.amount;
      return {
        type: 'transaction',
        id: t.id,
        title: t.description ?? 'Transaction',
        subtitle: `${typeLabels[t.type] ?? t.type} · ${new Date(t.date).toLocaleDateString('fr-FR')} · ${formatMoney(signedAmount, currency)}`,
      };
    }),
    ...categories.map((c) => ({ type: 'category', id: c.id, title: c.name, subtitle: categoryTypeLabels[c.type] ?? c.type })),
    ...accounts.map((a) => ({ type: 'account', id: a.id, title: a.name, subtitle: `${accountTypeLabel(a.type as AccountType)} · ${a.currency}` })),
    ...goals.map((g) => {
      // Savings goals don't carry an explicit currency yet; assume the reporting default.
      return {
        type: 'goal',
        id: g.id,
        title: g.name,
        subtitle: `${formatMoney(g.current_amount, 'EUR')} / ${formatMoney(g.target_amount, 'EUR')}`,
      };
    }),
  ]);
}));
