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
