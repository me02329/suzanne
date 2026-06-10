import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { contributeSavingsGoalSchema, createSavingsGoalSchema, idParam, updateSavingsGoalSchema } from '../lib/validation.js';
import { round2 } from '../lib/money.js';

export const goalsRouter = Router();

goalsRouter.get('/users/:user_id/savings-goals', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.savingsGoal.findMany({ where: { user_id }, orderBy: { id: 'desc' } }));
}));

goalsRouter.post('/users/:user_id/savings-goals', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createSavingsGoalSchema.parse(req.body);
  if (body.account_id) {
    const account = await prisma.account.findFirst({ where: { id: body.account_id, user_id } });
    if (!account) {
      res.status(400).json({ error: 'Compte introuvable pour cet utilisateur' });
      return;
    }
  }
  const row = await prisma.savingsGoal.create({
    data: {
      user_id,
      name: body.name,
      target_amount: body.target_amount,
      current_amount: body.current_amount,
      deadline: body.deadline ? new Date(body.deadline) : null,
      color: body.color,
      account_id: body.account_id ?? null,
    },
  });
  res.status(201).json(row);
}));

goalsRouter.patch('/users/:user_id/savings-goals/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateSavingsGoalSchema.parse(req.body);
  const existing = await prisma.savingsGoal.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const row = await prisma.savingsGoal.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.target_amount != null ? { target_amount: body.target_amount } : {}),
      ...(body.current_amount != null ? { current_amount: body.current_amount } : {}),
      ...(body.deadline !== undefined ? { deadline: body.deadline ? new Date(body.deadline) : null } : {}),
      ...(body.color != null ? { color: body.color } : {}),
      ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
    },
  });
  res.json(row);
}));

// "Verser" sur un objectif : crée optionnellement un transfert source → compte de l'objectif
// et bump `current_amount`. Si pas de compte source, on enregistre juste la contribution.
goalsRouter.post('/users/:user_id/savings-goals/:id/contribute', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = contributeSavingsGoalSchema.parse(req.body);
  const goal = await prisma.savingsGoal.findFirst({ where: { id, user_id } });
  if (!goal) {
    res.status(404).json({ error: 'Objectif introuvable' });
    return;
  }

  let createTransfer = false;
  if (body.source_account_id && goal.account_id) {
    if (body.source_account_id === goal.account_id) {
      res.status(400).json({ error: 'Le compte source doit être différent du compte de l\'objectif' });
      return;
    }
    const [src, dest] = await Promise.all([
      prisma.account.findFirst({ where: { id: body.source_account_id, user_id } }),
      prisma.account.findFirst({ where: { id: goal.account_id, user_id } }),
    ]);
    if (!src || !dest) {
      res.status(400).json({ error: 'Compte source ou destination introuvable' });
      return;
    }
    createTransfer = true;
  }

  // Transfert + bump du compteur dans une même transaction DB : pas de
  // versement enregistré sans la progression correspondante (et inversement).
  const results = await prisma.$transaction([
    ...(createTransfer
      ? [prisma.transaction.create({
          data: {
            user_id,
            account_id: body.source_account_id!,
            to_account_id: goal.account_id!,
            type: 'transfer',
            amount: round2(body.amount),
            date: new Date(body.date),
            description: body.description?.trim() || `Versement objectif: ${goal.name}`,
          },
        })]
      : []),
    prisma.savingsGoal.update({
      where: { id },
      data: { current_amount: round2(goal.current_amount + body.amount) },
    }),
  ]);
  const transactionId = createTransfer ? (results[0] as { id: number }).id : null;
  const updated = results[results.length - 1];
  res.json({ goal: updated, transaction_id: transactionId });
}));

goalsRouter.delete('/users/:user_id/savings-goals/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.savingsGoal.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));
