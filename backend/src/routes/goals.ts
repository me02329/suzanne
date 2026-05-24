import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createSavingsGoalSchema, idParam, updateSavingsGoalSchema } from '../lib/validation.js';

export const goalsRouter = Router();

goalsRouter.get('/users/:user_id/savings-goals', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.savingsGoal.findMany({ where: { user_id }, orderBy: { id: 'desc' } }));
}));

goalsRouter.post('/users/:user_id/savings-goals', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createSavingsGoalSchema.parse(req.body);
  const row = await prisma.savingsGoal.create({
    data: {
      user_id,
      name: body.name,
      target_amount: body.target_amount,
      current_amount: body.current_amount,
      deadline: body.deadline ? new Date(body.deadline) : null,
      color: body.color,
    },
  });
  res.status(201).json(row);
}));

goalsRouter.patch('/savings-goals/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const body = updateSavingsGoalSchema.parse(req.body);
  const row = await prisma.savingsGoal.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.target_amount != null ? { target_amount: body.target_amount } : {}),
      ...(body.current_amount != null ? { current_amount: body.current_amount } : {}),
      ...(body.deadline !== undefined ? { deadline: body.deadline ? new Date(body.deadline) : null } : {}),
      ...(body.color != null ? { color: body.color } : {}),
    },
  });
  res.json(row);
}));

goalsRouter.delete('/savings-goals/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await prisma.savingsGoal.delete({ where: { id } });
  res.json({ deleted: true });
}));
