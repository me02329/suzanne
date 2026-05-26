import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { idParam } from '../lib/validation.js';

export const searchRouter = Router();

searchRouter.get('/users/:user_id/search', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) {
    res.json([]);
    return;
  }
  const contains = { contains: q, mode: 'insensitive' as const };
  const [transactions, categories, accounts, goals] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id, description: contains }, take: 10, orderBy: { date: 'desc' } }),
    prisma.category.findMany({ where: { user_id, name: contains }, take: 10 }),
    prisma.account.findMany({ where: { user_id, name: contains }, take: 10 }),
    prisma.savingsGoal.findMany({ where: { user_id, name: contains }, take: 10 }),
  ]);
  res.json([
    ...transactions.map((t) => ({ type: 'transaction', id: t.id, title: t.description ?? 'Transaction', subtitle: `${t.type} · ${t.amount} €` })),
    ...categories.map((c) => ({ type: 'category', id: c.id, title: c.name, subtitle: c.type })),
    ...accounts.map((a) => ({ type: 'account', id: a.id, title: a.name, subtitle: accountTypeLabel(a.type) })),
    ...goals.map((g) => ({ type: 'goal', id: g.id, title: g.name, subtitle: `${g.current_amount}/${g.target_amount} €` })),
  ]);
}));

function accountTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    checking: 'Compte courant',
    savings: 'Épargne',
    livret_a: 'Livret A',
    ldds: 'LDDS',
    lep: 'LEP',
    pel: 'PEL',
    cel: 'CEL',
    pea: 'PEA',
    securities: 'Compte-titres',
    life_insurance: 'Assurance-vie',
    crypto: 'Crypto',
    retirement: 'Retraite',
    cash: 'Espèces',
    credit: 'Carte / crédit',
    loan: 'Emprunt',
    other: 'Autre',
  };
  return labels[type] ?? type;
}
