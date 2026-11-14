import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createTagSchema, idParam, updateTagSchema } from '../lib/validation.js';
import { categoryTypeLookup, LINE_SELECT, txFlows } from '../lib/ledger.js';
import { round2 } from '../lib/money.js';

export const tagsRouter = Router();

tagsRouter.get('/users/:user_id/tags', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const rows = await prisma.tag.findMany({
    where: { user_id },
    orderBy: { name: 'asc' },
  });
  res.json(rows);
}));

// Résumé par tag (toutes périodes) : nombre d'opérations, dépensé net des
// remboursements, reçu, dates. Montants dans la devise des comptes (non
// convertis) : un tag sert de 2e classement (ex. « Travail ») à côté de la
// catégorie.
tagsRouter.get('/users/:user_id/tags/summary', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const [links, categories] = await Promise.all([
    prisma.transactionTag.findMany({
      where: { tag: { user_id }, transaction: { deleted_at: null } },
      select: { tag_id: true, transaction: { select: { kind: true, date: true, lines: { select: LINE_SELECT } } } },
    }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, type: true } }),
  ]);
  const typeOf = categoryTypeLookup(categories);
  const out = new Map<number, { tag_id: number; count: number; expenses: number; income: number; first_date: string | null; last_date: string | null }>();
  for (const link of links) {
    const row = out.get(link.tag_id) ?? { tag_id: link.tag_id, count: 0, expenses: 0, income: 0, first_date: null, last_date: null };
    row.count += 1;
    for (const f of txFlows(link.transaction, typeOf)) {
      if (f.side === 'expense') row.expenses += f.value;
      else row.income += f.value;
    }
    const day = link.transaction.date.toISOString().slice(0, 10);
    if (!row.first_date || day < row.first_date) row.first_date = day;
    if (!row.last_date || day > row.last_date) row.last_date = day;
    out.set(link.tag_id, row);
  }
  res.json(Array.from(out.values()).map((r) => ({ ...r, expenses: round2(r.expenses), income: round2(r.income) })));
}));

tagsRouter.post('/users/:user_id/tags', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createTagSchema.parse(req.body);
  const existing = await prisma.tag.findFirst({ where: { user_id, name: body.name } });
  if (existing) {
    res.status(409).json({ error: 'Un tag avec ce nom existe déjà.' });
    return;
  }
  const row = await prisma.tag.create({ data: { user_id, name: body.name, color: body.color } });
  res.status(201).json(row);
}));

tagsRouter.patch('/users/:user_id/tags/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateTagSchema.parse(req.body);
  const existing = await prisma.tag.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Tag introuvable' });
    return;
  }
  if (body.name && body.name !== existing.name) {
    const dup = await prisma.tag.findFirst({ where: { user_id, name: body.name } });
    if (dup) { res.status(409).json({ error: 'Un tag avec ce nom existe déjà.' }); return; }
  }
  const row = await prisma.tag.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.color != null ? { color: body.color } : {}),
    },
  });
  res.json(row);
}));

tagsRouter.delete('/users/:user_id/tags/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.tag.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Tag introuvable' });
    return;
  }
  res.json({ deleted: true });
}));
