import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors.js';
import { idParam, monthString } from '../lib/validation.js';
import { checkAiHealth, runAiChat } from '../ai/client.js';
import { confirmAiAction, type PendingAiAction } from '../ai/tools.js';

export const aiRouter = Router();

const aiChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  month: monthString,
  currency: z.string().trim().min(3).max(3).default('EUR'),
});

const pendingActionSchema = z.object({
  type: z.enum(['create_transaction', 'update_transaction_category']),
  label: z.string().trim().min(1).max(300),
  payload: z.any(),
});

aiRouter.get('/ai/health', asyncHandler(async (_req, res) => {
  const status = await checkAiHealth();
  res.json(status);
}));

aiRouter.post('/users/:user_id/ai/chat', asyncHandler(async (req, res) => {
  const userId = idParam.parse(req.params.user_id);
  const body = aiChatSchema.parse(req.body);
  const result = await runAiChat(userId, body.message, { month: body.month, currency: body.currency });
  res.json(result);
}));

aiRouter.post('/users/:user_id/ai/confirm', asyncHandler(async (req, res) => {
  const userId = idParam.parse(req.params.user_id);
  const action = pendingActionSchema.parse(req.body.action) as PendingAiAction;
  const result = await confirmAiAction(userId, action);
  res.json({ ok: true, result });
}));
