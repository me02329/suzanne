import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { contributeSavingsGoalSchema, createSavingsGoalSchema, idParam, updateSavingsGoalSchema, withdrawSavingsGoalSchema } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { buildLines, linesCreateData, type BuiltLines } from '../lib/ledger.js';

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
  // Lignes du virement construites hors transaction DB (buildLines peut
  // interroger le fournisseur de taux si les devises diffèrent).
  const built = createTransfer
    ? await buildLines(prisma, user_id, { type: 'transfer', amount: body.amount, account_id: body.source_account_id!, to_account_id: goal.account_id!, date: body.date })
    : null;

  // Transfert + trace du versement + bump du compteur dans une même transaction
  // DB : pas de versement enregistré sans la progression correspondante (et
  // inversement). La contribution garde l'historique (timeline par objectif).
  const { updated, transactionId } = await prisma.$transaction(async (tx) => {
    const transfer = built
      ? await tx.transaction.create({
          data: transferData(user_id, built, body.date, body.description?.trim() || `Versement objectif: ${goal.name}`),
          select: { id: true },
        })
      : null;
    await tx.goalContribution.create({
      data: {
        user_id,
        goal_id: id,
        transaction_id: transfer?.id ?? null,
        amount: round2(body.amount),
        date: new Date(body.date),
        description: body.description?.trim() || null,
      },
    });
    // Incrément atomique : deux versements concurrents ne s'écrasent pas.
    const updatedGoal = await tx.savingsGoal.update({
      where: { id },
      data: { current_amount: { increment: round2(body.amount) } },
    });
    return { updated: updatedGoal, transactionId: transfer?.id ?? null };
  });
  res.json({ goal: updated, transaction_id: transactionId });
}));

// "Retirer" d'un objectif : symétrique du versement. Crée optionnellement un
// transfert compte de l'objectif → compte destination et décrémente
// `current_amount`. Le retrait est tracé comme une contribution NÉGATIVE (la
// timeline reste cohérente, et l'annuler recrédite l'objectif).
goalsRouter.post('/users/:user_id/savings-goals/:id/withdraw', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = withdrawSavingsGoalSchema.parse(req.body);
  const goal = await prisma.savingsGoal.findFirst({ where: { id, user_id } });
  if (!goal) {
    res.status(404).json({ error: 'Objectif introuvable' });
    return;
  }
  if (body.amount > goal.current_amount) {
    res.status(400).json({ error: 'Le retrait dépasse le montant épargné sur cet objectif' });
    return;
  }

  let createTransfer = false;
  if (body.destination_account_id && goal.account_id) {
    if (body.destination_account_id === goal.account_id) {
      res.status(400).json({ error: 'Le compte destination doit être différent du compte de l\'objectif' });
      return;
    }
    const [src, dest] = await Promise.all([
      prisma.account.findFirst({ where: { id: goal.account_id, user_id } }),
      prisma.account.findFirst({ where: { id: body.destination_account_id, user_id } }),
    ]);
    if (!src || !dest) {
      res.status(400).json({ error: 'Compte de l\'objectif ou destination introuvable' });
      return;
    }
    createTransfer = true;
  }
  const built = createTransfer
    ? await buildLines(prisma, user_id, { type: 'transfer', amount: body.amount, account_id: goal.account_id!, to_account_id: body.destination_account_id!, date: body.date })
    : null;

  const { updated, transactionId } = await prisma.$transaction(async (tx) => {
    // Décrément atomique et conditionnel : refusé si un autre retrait a fait
    // passer le solde de l'objectif sous le montant demandé entre-temps.
    const amount = round2(body.amount);
    const dec = await tx.savingsGoal.updateMany({
      where: { id, user_id, current_amount: { gte: amount - 0.005 } },
      data: { current_amount: { decrement: amount } },
    });
    if (dec.count === 0) throw new HttpError(400, 'Le retrait dépasse le montant épargné sur cet objectif');
    const transfer = built
      ? await tx.transaction.create({
          data: transferData(user_id, built, body.date, body.description?.trim() || `Retrait objectif: ${goal.name}`),
          select: { id: true },
        })
      : null;
    await tx.goalContribution.create({
      data: {
        user_id,
        goal_id: id,
        transaction_id: transfer?.id ?? null,
        amount: round2(-body.amount),
        date: new Date(body.date),
        description: body.description?.trim() || null,
      },
    });
    // Résidu d'arrondi flottant : jamais sous 0.
    await tx.savingsGoal.updateMany({ where: { id, current_amount: { lt: 0 } }, data: { current_amount: 0 } });
    const updatedGoal = await tx.savingsGoal.findUniqueOrThrow({ where: { id } });
    return { updated: updatedGoal, transactionId: transfer?.id ?? null };
  });
  res.json({ goal: updated, transaction_id: transactionId });
}));

goalsRouter.get('/users/:user_id/savings-goals/:id/contributions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const goal = await prisma.savingsGoal.findFirst({ where: { id, user_id }, select: { id: true } });
  if (!goal) {
    res.status(404).json({ error: 'Objectif introuvable' });
    return;
  }
  const rows = await prisma.goalContribution.findMany({
    where: { user_id, goal_id: id },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  res.json(rows.map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) })));
}));

// Annuler un versement : retire la ligne d'historique et décrémente la
// progression (clampée à 0 si le compteur a été édité à la main entre-temps).
// Le transfert éventuellement créé n'est PAS supprimé — il reste une vraie
// écriture comptable, à retirer côté transactions si besoin.
goalsRouter.delete('/users/:user_id/savings-goals/:id/contributions/:contribution_id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const contribution_id = idParam.parse(req.params.contribution_id);
  const contribution = await prisma.goalContribution.findFirst({
    where: { id: contribution_id, goal_id: id, user_id },
    include: { goal: true },
  });
  if (!contribution) {
    res.status(404).json({ error: 'Versement introuvable' });
    return;
  }
  const goal = await prisma.$transaction(async (tx) => {
    await tx.goalContribution.delete({ where: { id: contribution_id } });
    // Décrément atomique (incrément pour un retrait annulé), puis clamp à 0.
    await tx.savingsGoal.update({ where: { id }, data: { current_amount: { decrement: contribution.amount } } });
    await tx.savingsGoal.updateMany({ where: { id, current_amount: { lt: 0 } }, data: { current_amount: 0 } });
    return tx.savingsGoal.findUniqueOrThrow({ where: { id } });
  });
  res.json({ deleted: true, goal });
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

// Données de création du virement d'un versement / retrait (lignes source et
// destination issues de buildLines, chacune dans la devise de son compte).
function transferData(user_id: number, built: BuiltLines, date: string, description: string) {
  return {
    user_id,
    kind: built.kind,
    date: new Date(date),
    description,
    lines: { create: linesCreateData(user_id, built) },
  };
}
