import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createInstitutionSchema, idParam } from '../lib/validation.js';

export const institutionsRouter = Router();

institutionsRouter.get('/users/:user_id/institutions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.institution.findMany({ where: { user_id }, orderBy: { name: 'asc' } }));
}));

institutionsRouter.post('/users/:user_id/institutions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createInstitutionSchema.parse(req.body);
  const row = await prisma.institution.create({ data: { user_id, name: body.name } });
  res.status(201).json(row);
}));

institutionsRouter.patch('/users/:user_id/institutions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = createInstitutionSchema.parse(req.body);
  const result = await prisma.institution.updateMany({ where: { id, user_id }, data: { name: body.name } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }
  res.json(await prisma.institution.findFirst({ where: { id, user_id } }));
}));

institutionsRouter.delete('/users/:user_id/institutions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.institution.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Institution not found' });
    return;
  }
  res.json({ deleted: true });
}));
