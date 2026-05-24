import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createUserSchema, idParam } from '../lib/validation.js';

export const usersRouter = Router();

usersRouter.get('/users', asyncHandler(async (_req, res) => {
  res.json(await prisma.user.findMany({ orderBy: { name: 'asc' } }));
}));

usersRouter.post('/users', asyncHandler(async (req, res) => {
  const body = createUserSchema.parse(req.body);
  const user = await prisma.user.create({ data: body });
  res.status(201).json(user);
}));

usersRouter.delete('/users/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await prisma.user.delete({ where: { id } });
  res.json({ deleted: true });
}));
