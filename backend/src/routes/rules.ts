import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createCategoryRuleSchema, createTagRuleSchema, idParam, updateCategoryRuleSchema } from '../lib/validation.js';
import { applyRulesToUncategorized } from '../lib/categoryRules.js';
import { applyTagRules } from '../lib/tagRules.js';

export const rulesRouter = Router();

rulesRouter.get('/users/:user_id/category-rules', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.categoryRule.findMany({ where: { user_id }, orderBy: { pattern: 'asc' } }));
}));

rulesRouter.post('/users/:user_id/category-rules', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createCategoryRuleSchema.parse(req.body);
  const pattern = body.pattern.toUpperCase();
  const row = await prisma.categoryRule.upsert({
    where: { user_id_pattern: { user_id, pattern } },
    create: { user_id, pattern, category_id: body.category_id },
    update: { category_id: body.category_id },
  });
  res.json(row);
}));

// Apply the user's rules to their existing UNCATEGORIZED transactions, the same
// way the CSV import does (description contains the uppercase pattern → first
// matching rule wins). Deterministic, no AI. Only fills empty categories on
// income/expense rows — never overwrites an existing category, never touches
// transfers — so it is safe to re-run.
rulesRouter.post('/users/:user_id/category-rules/apply', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await applyRulesToUncategorized(user_id));
}));

rulesRouter.patch('/users/:user_id/category-rules/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateCategoryRuleSchema.parse(req.body);
  const existing = await prisma.categoryRule.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const pattern = body.pattern != null ? body.pattern.toUpperCase() : undefined;
  // Le motif est unique par utilisateur : renommer vers un motif déjà pris
  // (autre règle) doit échouer proprement plutôt que via l'erreur Prisma brute.
  if (pattern != null && pattern !== existing.pattern) {
    const clash = await prisma.categoryRule.findFirst({ where: { user_id, pattern }, select: { id: true } });
    if (clash) throw new HttpError(409, 'Une règle avec ce mot-clé existe déjà');
  }
  const row = await prisma.categoryRule.update({
    where: { id },
    data: {
      ...(pattern != null ? { pattern } : {}),
      ...(body.category_id != null ? { category_id: body.category_id } : {}),
    },
  });
  res.json(row);
}));

rulesRouter.delete('/users/:user_id/category-rules/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.categoryRule.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));

// ---- Règles de tag (libellé → tag) ------------------------------------------

rulesRouter.get('/users/:user_id/tag-rules', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.tagRule.findMany({ where: { user_id }, orderBy: [{ pattern: 'asc' }, { id: 'asc' }] }));
}));

rulesRouter.post('/users/:user_id/tag-rules', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createTagRuleSchema.parse(req.body);
  const tag = await prisma.tag.findFirst({ where: { id: body.tag_id, user_id }, select: { id: true } });
  if (!tag) throw new HttpError(400, 'Tag introuvable');
  const pattern = body.pattern.toUpperCase();
  const row = await prisma.tagRule.upsert({
    where: { user_id_pattern_tag_id: { user_id, pattern, tag_id: body.tag_id } },
    create: { user_id, pattern, tag_id: body.tag_id },
    update: {},
  });
  res.json(row);
}));

// Ajoute les tags des règles aux opérations existantes (n'enlève rien).
rulesRouter.post('/users/:user_id/tag-rules/apply', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await applyTagRules(user_id));
}));

rulesRouter.delete('/users/:user_id/tag-rules/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.tagRule.deleteMany({ where: { id, user_id } });
  if (result.count === 0) throw new HttpError(404, 'Règle introuvable');
  res.json({ deleted: true });
}));
