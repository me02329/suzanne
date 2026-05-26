import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createAccountSchema, idParam, updateAccountSchema } from '../lib/validation.js';

export const accountsRouter = Router();

accountsRouter.get('/users/:user_id/accounts', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.account.findMany({ where: { user_id }, orderBy: { name: 'asc' } }));
}));

accountsRouter.post('/users/:user_id/accounts', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createAccountSchema.parse(req.body);
  const row = await prisma.account.create({ data: { ...body, user_id, initial_balance_date: new Date(body.initial_balance_date) } });
  res.status(201).json(row);
}));

accountsRouter.patch('/users/:user_id/accounts/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateAccountSchema.parse(req.body);
  const existing = await prisma.account.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const row = await prisma.account.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.institution_id !== undefined ? { institution_id: body.institution_id ?? null } : {}),
      ...(body.type != null ? { type: body.type } : {}),
      ...(body.currency != null ? { currency: body.currency } : {}),
      ...(body.initial_balance != null ? { initial_balance: body.initial_balance } : {}),
      ...(body.initial_balance_date != null ? { initial_balance_date: new Date(body.initial_balance_date) } : {}),
    },
  });
  res.json(row);
}));

accountsRouter.delete('/users/:user_id/accounts/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.account.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));
