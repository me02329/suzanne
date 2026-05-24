import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createCategorySchema, idParam, updateCategorySchema } from '../lib/validation.js';

export const categoriesRouter = Router();

categoriesRouter.get('/users/:user_id/categories', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.category.findMany({ where: { user_id }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }));
}));

categoriesRouter.post('/users/:user_id/categories', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createCategorySchema.parse(req.body);
  const row = await prisma.category.create({ data: { ...body, user_id, icon: body.icon ?? null } });
  res.status(201).json(row);
}));

categoriesRouter.patch('/categories/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const body = updateCategorySchema.parse(req.body);
  const row = await prisma.category.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.type != null ? { type: body.type } : {}),
      ...(body.color != null ? { color: body.color } : {}),
      ...(body.icon !== undefined ? { icon: body.icon ?? null } : {}),
    },
  });
  res.json(row);
}));

categoriesRouter.delete('/categories/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await prisma.category.delete({ where: { id } });
  res.json({ deleted: true });
}));
