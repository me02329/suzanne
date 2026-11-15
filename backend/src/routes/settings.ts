import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { getAiConfig, updateAiSettings } from '../lib/settingsStore.js';
import { prisma } from '../prisma.js';
import { idParam } from '../lib/validation.js';

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
  // Sécurité : rediriger une clé déjà enregistrée vers une autre URL l'enverrait
  // à ce serveur au prochain appel. Changer d'URL impose de ressaisir la clé.
  if (body.base_url !== undefined) {
    const current = await getAiConfig();
    const changed = (body.base_url ?? '') !== (current.baseUrl ?? '');
    if (changed && current.apiKey && (body.api_key === undefined || body.api_key === null || body.api_key === '')) {
      throw new HttpError(400, "Ressaisis la clé API quand tu changes l'URL du fournisseur");
    }
  }
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

// Allocation cible par classe d'actifs (Analyse → Diversification), par profil.
// Stockée en JSON dans la table des réglages ; null tant que non définie.
const allocationKey = (user_id: number) => `allocation_target.${user_id}`;
const allocationSchema = z.object({
  cash: z.number().min(0).max(100),
  bonds: z.number().min(0).max(100),
  equities: z.number().min(0).max(100),
  real_estate: z.number().min(0).max(100),
  alternative: z.number().min(0).max(100),
}).refine((t) => Math.abs(t.cash + t.bonds + t.equities + t.real_estate + t.alternative - 100) < 0.5, { message: 'Les parts doivent totaliser 100 %.' });

settingsRouter.get('/users/:user_id/allocation-target', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const row = await prisma.setting.findUnique({ where: { key: allocationKey(user_id) } });
  res.json(row ? JSON.parse(row.value) : null);
}));

settingsRouter.put('/users/:user_id/allocation-target', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = allocationSchema.parse(req.body);
  await prisma.setting.upsert({
    where: { key: allocationKey(user_id) },
    create: { key: allocationKey(user_id), value: JSON.stringify(body) },
    update: { value: JSON.stringify(body) },
  });
  res.json(body);
}));
