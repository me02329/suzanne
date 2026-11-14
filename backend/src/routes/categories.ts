import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createCategorySchema, idParam, updateCategorySchema } from '../lib/validation.js';

export const categoriesRouter = Router();

categoriesRouter.get('/users/:user_id/categories', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.category.findMany({ where: { user_id }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }));
}));

categoriesRouter.post('/users/:user_id/categories', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createCategorySchema.parse(req.body);
  const row = await prisma.category.create({ data: { ...body, user_id, icon: body.icon ?? null, description: body.description || null } });
  res.status(201).json(row);
}));

categoriesRouter.patch('/users/:user_id/categories/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateCategorySchema.parse(req.body);
  const existing = await prisma.category.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const row = await prisma.category.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.type != null ? { type: body.type } : {}),
      ...(body.color != null ? { color: body.color } : {}),
      ...(body.icon !== undefined ? { icon: body.icon ?? null } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
    },
  });
  res.json(row);
}));

// Fusion de deux catégories : réaffecte tout ce qui pointe sur la source
// (lignes d'opérations, budgets, récurrents, règles, factures) vers la
// cible, puis supprime la source. Évite le « supprimer → tout devient sans
// catégorie » et permet de dédoublonner un référentiel.
const mergeCategorySchema = z.object({ target_category_id: z.coerce.number().int().positive() });

categoriesRouter.post('/users/:user_id/categories/:id/merge', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const sourceId = idParam.parse(req.params.id);
  const { target_category_id: targetId } = mergeCategorySchema.parse(req.body);
  if (sourceId === targetId) throw new HttpError(400, 'Une catégorie ne peut pas être fusionnée avec elle-même');
  const [source, target] = await Promise.all([
    prisma.category.findFirst({ where: { id: sourceId, user_id } }),
    prisma.category.findFirst({ where: { id: targetId, user_id } }),
  ]);
  if (!source || !target) throw new HttpError(404, 'Catégorie introuvable');
  // Garde-fou : revenus et dépenses ne se mélangent pas (les agrégats par type
  // en dépendent, et les budgets ne portent que sur des dépenses).
  if (source.type !== target.type) throw new HttpError(400, 'Les deux catégories doivent être du même type');

  // Budget : (user, catégorie, mois) est unique — pour les mois où la cible a
  // déjà un budget, on supprime celui de la source (sinon collision d'unicité) ;
  // les autres sont réaffectés tels quels.
  const targetMonths = (await prisma.budget.findMany({ where: { user_id, category_id: targetId }, select: { month: true } }))
    .map((row) => row.month);

  await prisma.$transaction([
    ...(targetMonths.length > 0
      ? [prisma.budget.deleteMany({ where: { user_id, category_id: sourceId, month: { in: targetMonths } } })]
      : []),
    prisma.budget.updateMany({ where: { user_id, category_id: sourceId }, data: { category_id: targetId } }),
    // Toutes les lignes, corbeille comprise (une restauration doit retrouver la cible).
    prisma.transactionLine.updateMany({ where: { user_id, category_id: sourceId }, data: { category_id: targetId } }),
    prisma.recurringTransaction.updateMany({ where: { user_id, category_id: sourceId }, data: { category_id: targetId } }),
    prisma.categoryRule.updateMany({ where: { user_id, category_id: sourceId }, data: { category_id: targetId } }),
    prisma.bill.updateMany({ where: { user_id, category_id: sourceId }, data: { category_id: targetId } }),
    prisma.category.delete({ where: { id: sourceId } }),
  ]);
  res.json({ merged: true, target_category_id: targetId });
}));

// Suppression : les lignes d'opérations qui la portent deviennent « sans
// catégorie » (FK SetNull) — on ne touche jamais aux lignes ici, une
// ventilation garde donc ses montants.
categoriesRouter.delete('/users/:user_id/categories/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.category.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));
