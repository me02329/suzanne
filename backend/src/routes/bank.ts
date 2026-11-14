// Connexions bancaires (Enable Banking, DSP2, lecture seule). Toutes les routes
// sont sous /users/:user_id/bank ; la logique est dans lib/bankSync.ts.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { dateString, idParam } from '../lib/validation.js';
import { assertAccountOwned } from '../lib/transactionHelpers.js';
import {
  bankClient, bankConfig, completeAuthorization, deleteConnection, listAspsps, startAuthorization, syncConnection, syncLink,
} from '../lib/bankSync.js';

export const bankRouter = Router();

const country = z.string().regex(/^[A-Z]{2}$/).default('FR');

// État : configuration du serveur (pour le guide d'activation) et connexions.
bankRouter.get('/users/:user_id/bank', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const { config, error } = bankConfig();
  const connections = await prisma.bankConnection.findMany({
    where: { user_id },
    orderBy: { created_at: 'asc' },
    include: { links: { orderBy: { id: 'asc' } } },
  });
  res.json({
    configured: config != null,
    config_error: error,
    redirect_url: config?.redirectUrl ?? null,
    app_id: config ? `${config.appId.slice(0, 8)}…` : null,
    connections: connections.map(({ session_id: _session, ...c }) => ({
      ...c,
      expired: c.valid_until.getTime() < Date.now(),
      links: c.links.map((l) => ({ ...l, sync_from: l.sync_from?.toISOString().slice(0, 10) ?? null })),
    })),
  });
}));

// Vérifie la clé et l'application auprès d'Enable Banking (étape du guide).
bankRouter.get('/users/:user_id/bank/check', asyncHandler(async (req, res) => {
  idParam.parse(req.params.user_id);
  try {
    const app = await bankClient().application() as { name?: string; active?: boolean; environment?: string; redirect_urls?: string[] };
    const { config } = bankConfig();
    res.json({
      ok: true,
      name: app.name ?? null,
      active: app.active ?? null,
      environment: app.environment ?? null,
      redirect_url_registered: config ? (app.redirect_urls ?? []).includes(config.redirectUrl) : null,
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    res.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}));

bankRouter.get('/users/:user_id/bank/aspsps', asyncHandler(async (req, res) => {
  idParam.parse(req.params.user_id);
  const list = await listAspsps(country.parse(req.query.country ?? 'FR'));
  res.json(list.map((b) => ({
    name: b.name, country: b.country, bic: b.bic ?? null, beta: b.beta ?? false,
    logo: (b as { logo?: string }).logo ?? null,
    consent_days: b.maximum_consent_validity ? Math.floor(b.maximum_consent_validity / 86400) : null,
  })));
}));

bankRouter.post('/users/:user_id/bank/auth', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = z.object({ aspsp_name: z.string().min(1).max(200), country }).parse(req.body);
  res.json(await startAuthorization(user_id, body.aspsp_name, body.country));
}));

// Retour de la banque (la page /bank/callback du front transmet code et state).
bankRouter.post('/users/:user_id/bank/callback', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = z.object({ code: z.string().min(1).max(500), state: z.string().min(1).max(2000) }).parse(req.body);
  const connection = await completeAuthorization(user_id, body.code, body.state);
  const { session_id: _session, ...rest } = connection;
  res.status(201).json(rest);
}));

// Association compte distant ↔ compte Suzanne, et date de début de synchro.
bankRouter.patch('/users/:user_id/bank/links/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = z.object({ account_id: z.number().int().positive().nullable().optional(), sync_from: dateString.nullable().optional() }).parse(req.body);
  const link = await prisma.bankLink.findFirst({ where: { id, user_id } });
  if (!link) throw new HttpError(404, 'Compte bancaire introuvable');
  if (body.account_id) {
    await assertAccountOwned(user_id, body.account_id);
    const taken = await prisma.bankLink.findFirst({ where: { user_id, account_id: body.account_id, NOT: { id } }, select: { id: true } });
    if (taken) throw new HttpError(409, 'Ce compte Suzanne est déjà associé à un autre compte bancaire.');
  }
  const changedTarget = body.account_id !== undefined && body.account_id !== link.account_id;
  const updated = await prisma.bankLink.update({
    where: { id },
    data: {
      ...(body.account_id !== undefined ? { account_id: body.account_id } : {}),
      ...(body.sync_from !== undefined ? { sync_from: body.sync_from ? new Date(`${body.sync_from}T00:00:00.000Z`) : null } : {}),
      // Nouveau compte cible : la prochaine synchro repart de sync_from.
      ...(changedTarget ? { last_sync_at: null, last_result: undefined } : {}),
    },
  });
  res.json({ ...updated, sync_from: updated.sync_from?.toISOString().slice(0, 10) ?? null });
}));

bankRouter.post('/users/:user_id/bank/connections/:id/sync', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json({ results: await syncConnection(user_id, idParam.parse(req.params.id)) });
}));

bankRouter.post('/users/:user_id/bank/links/:id/sync', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json({ results: [await syncLink(user_id, idParam.parse(req.params.id))] });
}));

bankRouter.delete('/users/:user_id/bank/connections/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  await deleteConnection(user_id, idParam.parse(req.params.id));
  res.json({ deleted: true });
}));
