import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors.js';
import { getAiConfig, updateAiSettings } from '../lib/settingsStore.js';

export const settingsRouter = Router();

// Public view of the AI config. Never leak the API key — only whether it's set.
settingsRouter.get('/settings/ai', asyncHandler(async (_req, res) => {
  const cfg = await getAiConfig();
  res.json({
    configured: Boolean(cfg.apiKey),
    has_key: Boolean(cfg.apiKey),
    model: cfg.model,
    base_url: cfg.baseUrl,
    provider: cfg.provider,
    source: cfg.source,
  });
}));

const aiUpdateSchema = z.object({
  // null/'' on `api_key` clears the DB-stored key (env may still apply).
  // omitting `api_key` keeps it untouched.
  api_key: z.string().nullable().optional(),
  model: z.string().trim().min(1).max(120).nullable().optional(),
  base_url: z.string().trim().url().max(300).nullable().optional(),
  provider: z.string().trim().min(1).max(60).nullable().optional(),
});

settingsRouter.put('/settings/ai', asyncHandler(async (req, res) => {
  const body = aiUpdateSchema.parse(req.body);
  await updateAiSettings({
    apiKey: body.api_key,
    model: body.model,
    baseUrl: body.base_url,
    provider: body.provider,
  });
  const cfg = await getAiConfig();
  res.json({
    configured: Boolean(cfg.apiKey),
    has_key: Boolean(cfg.apiKey),
    model: cfg.model,
    base_url: cfg.baseUrl,
    provider: cfg.provider,
    source: cfg.source,
  });
}));
