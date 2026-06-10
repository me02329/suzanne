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
  // `recurring` omis = on ne touche pas au flag existant : re-saisir une
  // limite ne doit pas désactiver silencieusement la reconduction.
  const row = await prisma.budget.upsert({
    where: { user_id_category_id_month: { user_id, category_id: body.category_id, month: body.month } },
    create: { category_id: body.category_id, month: body.month, amount_limit: body.amount_limit, recurring: body.recurring ?? false, user_id },
    update: { amount_limit: body.amount_limit, ...(body.recurring !== undefined ? { recurring: body.recurring } : {}) },
  });
  res.json(row);
}));

budgetsRouter.delete('/users/:user_id/budgets/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const existing = await prisma.budget.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  // Supprimer un budget reconduit signifie « arrêter cette reconduction » :
  // sans ça, ensureRecurringBudgets le recréerait au prochain affichage du
  // mois depuis un mois antérieur. On coupe donc le flag sur toute la chaîne
  // de la catégorie (l'historique des montants reste en place).
  await prisma.$transaction([
    prisma.budget.delete({ where: { id } }),
    ...(existing.recurring
      ? [prisma.budget.updateMany({
          where: { user_id, category_id: existing.category_id, recurring: true },
          data: { recurring: false },
        })]
      : []),
  ]);
  res.json({ deleted: true });
}));

// Reconduction : pour chaque catégorie, on regarde le budget le plus récent
// strictement antérieur au mois demandé — c'est lui qui fait foi. S'il est
// marqué `recurring`, on le copie sur le mois ; s'il ne l'est pas (reconduction
// arrêtée), on ne crée rien, même si un mois plus ancien était reconduit.
async function ensureRecurringBudgets(user_id: number, month: string): Promise<void> {
  const [existingForMonth, previousBudgets] = await Promise.all([
    prisma.budget.findMany({ where: { user_id, month }, select: { category_id: true } }),
    prisma.budget.findMany({
      where: { user_id, month: { lt: month } },
      orderBy: [{ month: 'desc' }, { id: 'desc' }],
    }),
  ]);
  const existingCategoryIds = new Set(existingForMonth.map((budget) => budget.category_id));
  const latestByCategory = new Map<number, typeof previousBudgets[number]>();
  for (const budget of previousBudgets) {
    if (!latestByCategory.has(budget.category_id)) latestByCategory.set(budget.category_id, budget);
  }
  const toCreate = Array.from(latestByCategory.values())
    .filter((budget) => budget.recurring && !existingCategoryIds.has(budget.category_id))
    .map((budget) => ({
      user_id,
      category_id: budget.category_id,
      month,
      amount_limit: budget.amount_limit,
      recurring: true,
    }));
  // skipDuplicates : deux GET concurrents (deux onglets) ne doivent pas faire
  // un 409 sur la contrainte (user, category, month).
  if (toCreate.length > 0) await prisma.budget.createMany({ data: toCreate, skipDuplicates: true });
}
