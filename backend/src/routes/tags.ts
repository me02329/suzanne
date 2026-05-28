import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createTagSchema, idParam, updateTagSchema } from '../lib/validation.js';

export const tagsRouter = Router();

tagsRouter.get('/users/:user_id/tags', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const rows = await prisma.tag.findMany({
    where: { user_id },
    orderBy: { name: 'asc' },
  });
  res.json(rows);
}));

tagsRouter.post('/users/:user_id/tags', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createTagSchema.parse(req.body);
  const existing = await prisma.tag.findFirst({ where: { user_id, name: body.name } });
  if (existing) {
    res.status(409).json({ error: 'Un tag avec ce nom existe déjà.' });
    return;
  }
  const row = await prisma.tag.create({ data: { user_id, name: body.name, color: body.color } });
  res.status(201).json(row);
}));

tagsRouter.patch('/users/:user_id/tags/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateTagSchema.parse(req.body);
  const existing = await prisma.tag.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Tag introuvable' });
    return;
  }
  if (body.name && body.name !== existing.name) {
    const dup = await prisma.tag.findFirst({ where: { user_id, name: body.name } });
    if (dup) { res.status(409).json({ error: 'Un tag avec ce nom existe déjà.' }); return; }
  }
  const row = await prisma.tag.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.color != null ? { color: body.color } : {}),
    },
  });
  res.json(row);
}));

tagsRouter.delete('/users/:user_id/tags/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.tag.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Tag introuvable' });
    return;
  }
  res.json({ deleted: true });
}));
