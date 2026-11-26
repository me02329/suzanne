import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, prismaBase } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { idParam } from '../lib/validation.js';
import { detectAnomalies, type AnomalyTx } from '../lib/anomalies.js';
import { detectTransferPairs, type PairCandidate, type TransferPair } from '../lib/transferPairs.js';
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
  res.json({
    ...report, no_category, duplicates, dismissed_duplicates: report.duplicates.length - duplicates.length,
    transfer_pairs: await transferPairsFor(user_id, hidden),
  });
}));

// ---- Virements à relier ------------------------------------------------------

const PAIR_HISTORY_DAYS = 400;

/** Opérations simples (une ligne, sur un compte) qui pourraient être les deux côtés d'un virement. */
async function transferPairsFor(user_id: number, dismissed: Set<string>): Promise<TransferPair[]> {
  const rows = await prisma.transaction.findMany({
    where: { user_id, kind: 'standard', date: { gte: new Date(Date.now() - PAIR_HISTORY_DAYS * 86400000) } },
    select: { id: true, date: true, description: true, lines: { select: { account_id: true, amount: true, account: { select: { currency: true } } } } },
  });
  const candidates: PairCandidate[] = rows
    .filter((t) => t.lines.length === 1 && t.lines[0]!.account_id != null)
    .map((t) => ({ id: t.id, date: t.date, description: t.description, account_id: t.lines[0]!.account_id!, amount: t.lines[0]!.amount, currency: t.lines[0]!.account?.currency ?? 'EUR' }));
  return detectTransferPairs(candidates, dismissed);
}

const linkPairSchema = z.object({ out_id: z.coerce.number().int().positive(), in_id: z.coerce.number().int().positive() });

/**
 * Relie deux opérations en un virement : la sortie devient le virement et
 * reçoit la ligne de l'entrée (sans catégorie : ni dépense ni revenu) ; l'entrée
 * disparaît, ses tags, pièces jointes et données bancaires passent sur le
 * virement. Montants différents seulement entre deux devises.
 */
anomaliesRouter.post('/users/:user_id/transfer-pairs/link', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = linkPairSchema.parse(req.body);
  if (body.out_id === body.in_id) throw new HttpError(400, 'Choisis deux opérations différentes');
  const select = {
    id: true, kind: true, import_fingerprint: true, bank_data: true, recurring_transaction_id: true,
    lines: { select: { id: true, account_id: true, amount: true, account: { select: { currency: true } } } },
  } as const;
  const [out, inc] = await Promise.all([
    prisma.transaction.findFirst({ where: { id: body.out_id, user_id }, select }),
    prisma.transaction.findFirst({ where: { id: body.in_id, user_id }, select }),
  ]);
  if (!out || !inc) throw new HttpError(404, 'Opération introuvable');
  const o = out.lines[0];
  const i = inc.lines[0];
  if (out.kind !== 'standard' || inc.kind !== 'standard' || out.lines.length !== 1 || inc.lines.length !== 1 || !o?.account_id || !i?.account_id) {
    throw new HttpError(400, 'Seules deux opérations simples, chacune sur un compte, peuvent être reliées en virement');
  }
  if (o.account_id === i.account_id) throw new HttpError(400, 'Un virement relie deux comptes différents');
  if (!(o.amount < 0 && i.amount > 0)) throw new HttpError(400, 'Il faut une sortie d’argent et une entrée d’argent');
  if (o.account?.currency === i.account?.currency && Math.abs(o.amount + i.amount) >= 0.005) {
    throw new HttpError(400, 'Les deux montants doivent être égaux (même devise)');
  }
  const bankData = [out.bank_data, inc.bank_data].flatMap((d) => (Array.isArray(d) ? d : d != null ? [d] : []));
  await prismaBase.$transaction(async (db) => {
    await db.transactionLine.update({ where: { id: o.id }, data: { category_id: null, refund: false, refund_of_id: null, position: 0 } });
    await db.transactionLine.update({ where: { id: i.id }, data: { transaction_id: out.id, category_id: null, refund: false, refund_of_id: null, position: 1 } });
    // Tags et pièces jointes de l'entrée : rattachés au virement.
    const tags = await db.transactionTag.findMany({ where: { transaction_id: inc.id }, select: { tag_id: true } });
    if (tags.length > 0) await db.transactionTag.createMany({ data: tags.map((t) => ({ transaction_id: out.id, tag_id: t.tag_id })), skipDuplicates: true });
    await db.attachment.updateMany({ where: { transaction_id: inc.id }, data: { transaction_id: out.id } });
    await db.transaction.update({
      where: { id: out.id },
      data: {
        kind: 'transfer',
        // Empreinte : celle de la sortie, sinon celle de l'entrée (une nouvelle
        // synchro reconnaît aussi l'autre côté, par compte et montant).
        import_fingerprint: out.import_fingerprint ?? inc.import_fingerprint,
        recurring_transaction_id: out.recurring_transaction_id ?? inc.recurring_transaction_id,
        ...(bankData.length > 0 ? { bank_data: bankData as Prisma.InputJsonValue } : {}),
      },
    });
    await db.transaction.delete({ where: { id: inc.id } });
  });
  res.json({ transaction_id: out.id });
}));

/** « Ce n'est pas un virement » : la paire n'est plus proposée. */
anomaliesRouter.post('/users/:user_id/transfer-pairs/dismiss', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = linkPairSchema.parse(req.body);
  const [a_id, b_id] = body.out_id < body.in_id ? [body.out_id, body.in_id] : [body.in_id, body.out_id];
  const owned = await prisma.transaction.count({ where: { user_id, id: { in: [a_id, b_id] } } });
  if (owned !== 2) throw new HttpError(404, 'Opération introuvable');
  await prisma.duplicateDismissal.upsert({ where: { user_id_a_id_b_id: { user_id, a_id, b_id } }, create: { user_id, a_id, b_id }, update: {} });
  res.json({ dismissed: true });
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
