import { Router } from 'express';
import { Prisma } from '@prisma/client';
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

institutionsRouter.delete('/institutions/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  try {
    await prisma.institution.delete({ where: { id } });
    res.json({ deleted: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      res.status(404).json({ error: 'Institution not found' });
      return;
    }
    throw err;
  }
}));
