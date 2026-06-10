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
  await createDefaultsForUser(user.id);
  res.status(201).json(user);
}));

usersRouter.delete('/users/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await prisma.user.delete({ where: { id } });
  res.json({ deleted: true });
}));

async function createDefaultsForUser(user_id: number) {
  await prisma.account.create({
    data: {
      user_id,
      name: 'Compte courant',
      type: 'checking',
      currency: 'EUR',
      initial_balance: 0,
      // Solde initial daté du jour de création (et non une date codée en dur).
      initial_balance_date: new Date(new Date().toISOString().slice(0, 10)),
    },
  });

  await prisma.category.createMany({
    data: [
      { user_id, name: 'Courses', type: 'expense', color: '#22c55e', icon: 'shopping-cart' },
      { user_id, name: 'Logement', type: 'expense', color: '#f97316', icon: 'home' },
      { user_id, name: 'Transport', type: 'expense', color: '#06b6d4', icon: 'car' },
      { user_id, name: 'Loisirs', type: 'expense', color: '#a855f7', icon: 'gamepad-2' },
      { user_id, name: 'Santé', type: 'expense', color: '#ef4444', icon: 'heart-pulse' },
      { user_id, name: 'Salaire', type: 'income', color: '#16a34a', icon: 'wallet' },
      { user_id, name: 'Remboursement', type: 'income', color: '#0ea5e9', icon: 'refresh-cw' },
    ],
    skipDuplicates: true,
  });
}
