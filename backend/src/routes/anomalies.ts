import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { idParam } from '../lib/validation.js';
import { detectAnomalies, type AnomalyTx } from '../lib/anomalies.js';
import { bucketByRule } from '../lib/categoryRules.js';
import { LEDGER_TX_SELECT, legacyView, LINES_ORDERED, LINE_SELECT } from '../lib/ledger.js';

export const anomaliesRouter = Router();

// Analyse de qualité des données : orphelins (sans compte), sans catégorie, et
// doublons probables. Lecture seule — l'utilisateur corrige depuis Transactions.
anomaliesRouter.get('/users/:user_id/anomalies', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const transactions = await prisma.transaction.findMany({
    where: { user_id },
    select: { ...LEDGER_TX_SELECT, description: true, lines: { select: LINE_SELECT, ...LINES_ORDERED } },
  });
  // Vue « une ligne par opération » dérivée des lignes : type historique
  // (ou le genre pour trade / adjustment, exclus des contrôles), compte
  // manquant si une ligne n'en a pas, catégorie manquante si une ligne non
  // remboursement n'en a pas (une ventilation entièrement catégorisée est OK).
  const rows: AnomalyTx[] = transactions.map((t) => {
    const view = legacyView(t);
    const missingAccount = t.lines.some((l) => l.account_id == null);
    const missingCategory = t.lines.length === 0 || t.lines.some((l) => l.category_id == null && !l.refund);
    const firstCategory = t.lines.find((l) => l.category_id != null)?.category_id ?? null;
    return {
      id: t.id,
      date: t.date,
      amount: view.amount,
      type: t.kind === 'standard' || t.kind === 'transfer' ? view.type : t.kind,
      description: t.description,
      account_id: missingAccount ? null : view.account_id,
      category_id: missingCategory ? null : view.category_id ?? firstCategory,
    };
  });
  const report = detectAnomalies(rows);
  // Paires validées par l'utilisateur (« pas un doublon ») : masquées.
  const dismissed = await prisma.duplicateDismissal.findMany({ where: { user_id }, select: { a_id: true, b_id: true } });
  const key = (x: number, y: number) => (x < y ? `${x}-${y}` : `${y}-${x}`);
  const hidden = new Set(dismissed.map((d) => key(d.a_id, d.b_id)));
  const duplicates = report.duplicates.filter((p) => !hidden.has(key(p.a.id, p.b.id)));

  // Catégorie proposée pour les opérations sans catégorie : la première règle
  // qui correspond, sinon la catégorie la plus fréquente du même libellé
  // (même sens dépense/revenu) dans l'historique.
  const [rules, categories] = await Promise.all([
    prisma.categoryRule.findMany({ where: { user_id }, orderBy: { id: 'asc' }, select: { pattern: true, category_id: true } }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, type: true } }),
  ]);
  const typeOf = new Map(categories.map((c) => [c.id, c.type as string]));
  const byRule = new Map<number, number>();
  for (const [categoryId, ids] of bucketByRule(report.no_category, rules.map((r) => ({ pattern: r.pattern.toUpperCase(), category_id: r.category_id })))) {
    for (const id of ids) byRule.set(id, categoryId);
  }
  const norm = (d: string | null) => (d ?? '').toUpperCase().replace(/[0-9]/g, '').replace(/\s+/g, ' ').trim();
  const history = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (r.category_id == null || !r.description) continue;
    const k = `${r.type}|${norm(r.description)}`;
    const counts = history.get(k) ?? new Map<number, number>();
    counts.set(r.category_id, (counts.get(r.category_id) ?? 0) + 1);
    history.set(k, counts);
  }
  const no_category = report.no_category.map((t) => {
    let suggested = byRule.get(t.id) ?? null;
    if (suggested == null && t.description) {
      const counts = history.get(`${t.type}|${norm(t.description)}`);
      if (counts) suggested = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    }
    // Une proposition doit être du bon sens (dépense ↔ catégorie de dépense).
    if (suggested != null && typeOf.get(suggested) !== t.type) suggested = null;
    return { ...t, suggested_category_id: suggested };
  });
  res.json({ ...report, no_category, duplicates, dismissed_duplicates: report.duplicates.length - duplicates.length });
}));

const pairSchema = z.object({ a_id: z.coerce.number().int().positive(), b_id: z.coerce.number().int().positive() });

// « Ce n'est pas un doublon » : la paire n'est plus proposée.
anomaliesRouter.post('/users/:user_id/anomalies/duplicates/dismiss', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = pairSchema.parse(req.body);
  if (body.a_id === body.b_id) throw new HttpError(400, 'Une paire exige deux opérations distinctes');
  const [a_id, b_id] = body.a_id < body.b_id ? [body.a_id, body.b_id] : [body.b_id, body.a_id];
  const owned = await prisma.transaction.count({ where: { user_id, id: { in: [a_id, b_id] } } });
  if (owned !== 2) throw new HttpError(404, 'Opération introuvable');
  await prisma.duplicateDismissal.upsert({
    where: { user_id_a_id_b_id: { user_id, a_id, b_id } },
    create: { user_id, a_id, b_id },
    update: {},
  });
  res.status(201).json({ dismissed: true });
}));

// Réafficher toutes les paires validées.
anomaliesRouter.delete('/users/:user_id/anomalies/duplicates/dismiss', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const result = await prisma.duplicateDismissal.deleteMany({ where: { user_id } });
  res.json({ restored: result.count });
}));
