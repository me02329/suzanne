import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createCategoryRuleSchema, idParam } from '../lib/validation.js';

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
  const [rules, categories, uncategorized] = await Promise.all([
    prisma.categoryRule.findMany({ where: { user_id }, orderBy: { pattern: 'asc' } }),
    prisma.category.findMany({ where: { user_id }, select: { id: true } }),
    prisma.transaction.findMany({
      where: { user_id, category_id: null, type: { not: 'transfer' } },
      select: { id: true, description: true },
    }),
  ]);
  // Skip rules whose category was since deleted, to avoid a foreign-key error.
  const validCategory = new Set(categories.map((c) => c.id));
  const activeRules = rules.filter((r) => validCategory.has(r.category_id));

  // Bucket transaction ids by the category their first matching rule assigns,
  // then one updateMany per category instead of one write per transaction.
  const idsByCategory = new Map<number, number[]>();
  for (const tx of uncategorized) {
    const description = (tx.description ?? '').toUpperCase();
    const rule = activeRules.find((r) => description.includes(r.pattern));
    if (!rule) continue;
    const list = idsByCategory.get(rule.category_id);
    if (list) list.push(tx.id); else idsByCategory.set(rule.category_id, [tx.id]);
  }

  let categorized = 0;
  for (const [category_id, ids] of idsByCategory) {
    const result = await prisma.transaction.updateMany({
      where: { id: { in: ids }, user_id, category_id: null },
      data: { category_id },
    });
    categorized += result.count;
  }
  res.json({ categorized, scanned: uncategorized.length });
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
