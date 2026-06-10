import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { idParam, monthString } from '../lib/validation.js';
import { checkAiHealth, runAiChat, streamAiChat } from '../ai/client.js';
import { confirmAiAction, type PendingAiAction } from '../ai/tools.js';

export const aiRouter = Router();

// Cap calls to the paid chat endpoints per user (keyed by route param, with an
// IP fallback) so a stuck client can't run up the AI bill. Overridable via env.
const aiChatLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.AI_RATE_LIMIT_PER_MIN ?? 20),
  key: (req) => `ai:${req.params.user_id ?? req.ip}`,
});

const aiChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  month: monthString,
  currency: z.string().trim().min(3).max(3).default('EUR'),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    // Truncate rather than reject: a long assistant answer (markdown analyses
    // easily exceed 4000 chars) must not 400 the whole follow-up. initialMessages
    // trims further to 2000 before sending upstream.
    content: z.string().trim().min(1).transform((c) => c.slice(0, 4000)),
  })).max(12).default([]),
});

// The type is validated against the dispatch in confirmAiAction; we keep the
// schema permissive here so adding new propose_* tools doesn't require
// touching this route every time.
const pendingActionSchema = z.object({
  type: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(300),
  payload: z.any(),
});

aiRouter.get('/ai/health', asyncHandler(async (_req, res) => {
  const status = await checkAiHealth();
  res.json(status);
}));

aiRouter.post('/users/:user_id/ai/chat', aiChatLimiter, asyncHandler(async (req, res) => {
  const userId = idParam.parse(req.params.user_id);
  const body = aiChatSchema.parse(req.body);
  const result = await runAiChat(userId, body.message, { month: body.month, currency: body.currency }, body.history);
  res.json(result);
}));

aiRouter.post('/users/:user_id/ai/chat/stream', aiChatLimiter, asyncHandler(async (req, res) => {
  const userId = idParam.parse(req.params.user_id);
  const body = aiChatSchema.parse(req.body);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // `req.on('aborted')` est déprécié ; `close` sur la réponse couvre la
  // déconnexion client (et la fin normale, où la boucle est déjà sortie).
  let aborted = false;
  res.on('close', () => { aborted = true; });

  try {
    for await (const event of streamAiChat(userId, body.message, { month: body.month, currency: body.currency }, body.history)) {
      if (aborted || res.destroyed || res.writableEnded) break;
      send(event);
    }
  } catch (e) {
    send({ kind: 'error', error: { kind: 'network', message: (e as Error).message, detail: '' } });
  } finally {
    res.end();
  }
}));

aiRouter.post('/users/:user_id/ai/confirm', asyncHandler(async (req, res) => {
  const userId = idParam.parse(req.params.user_id);
  const action = pendingActionSchema.parse(req.body.action) as PendingAiAction;
  const result = await confirmAiAction(userId, action);
  res.json({ ok: true, result });
}));
