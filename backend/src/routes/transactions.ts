import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createTransactionSchema, idParam, linkRecurringSchema, monthString, updateTransactionSchema } from '../lib/validation.js';
import {
  assertRefundTarget,
  assertTransactionReferences,
  assertTransactionSplits,
  resolveTagIds,
  transferAmounts,
} from '../lib/transactionHelpers.js';

export const transactionsRouter = Router();

// Relations embarquées dans chaque transaction renvoyée : les remboursements
// reçus (sur une dépense) et un aperçu de la dépense remboursée (sur un revenu).
export const transactionInclude = {
  tags: { include: { tag: true } },
  splits: { orderBy: { id: 'asc' as const } },
  refunded_by: { select: { id: true, amount: true, date: true }, orderBy: { date: 'asc' as const } },
  refunds_transaction: { select: { id: true, amount: true, date: true, description: true } },
};

transactionsRouter.get('/users/:user_id/transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = req.query.month ? monthString.parse(req.query.month) : null;
  const issue = req.query.issue ? z.enum(['unassigned_account']).parse(req.query.issue) : null;
  // Filtres optionnels (recherche d'une dépense à lier à un remboursement).
  const type = req.query.type ? z.enum(['expense', 'income', 'transfer']).parse(req.query.type) : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limit = req.query.limit ? z.coerce.number().int().min(1).max(100).parse(req.query.limit) : null;
  const where = month
    ? { user_id, date: { gte: new Date(`${month}-01T00:00:00.000Z`), lt: new Date(nextMonth(month)) } }
    : { user_id };
  const rows = await prisma.transaction.findMany({
    where: {
      ...where,
      ...(issue === 'unassigned_account' ? { type: { not: 'transfer' as const }, account_id: null } : {}),
      ...(type ? { type } : {}),
      ...(q ? { description: { contains: q, mode: 'insensitive' as const } } : {}),
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    ...(limit ? { take: limit } : {}),
    include: transactionInclude,
  });
  res.json(rows.map(serializeTransaction));
}));

transactionsRouter.post('/users/:user_id/transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createTransactionSchema.parse(req.body);
  await assertTransactionReferences(user_id, body);
  if (body.refunds_transaction_id != null) {
    await assertRefundTarget(user_id, body.refunds_transaction_id);
  }
  await assertTransactionSplits(user_id, body.type, body.splits, body.amount);
  const transfer = await transferAmounts(user_id, body);
  const tagIds = await resolveTagIds(user_id, body.tag_ids);
  const splits = body.type === 'transfer' ? [] : body.splits ?? [];
  const row = await prisma.transaction.create({
    data: {
      user_id,
      account_id: body.account_id ?? null,
      to_account_id: body.type === 'transfer' ? body.to_account_id ?? null : null,
      category_id: splits.length > 0 || body.type === 'transfer' ? null : body.category_id ?? null,
      refunds_transaction_id: body.type === 'income' ? body.refunds_transaction_id ?? null : null,
      amount: body.amount,
      to_amount: transfer.toAmount,
      exchange_rate: transfer.exchangeRate,
      type: body.type,
      date: new Date(body.date),
      description: body.description ?? null,
      tags: { create: tagIds.map((tag_id) => ({ tag_id })) },
      splits: splits.length > 0
        ? { create: splits.map((split) => ({
            user_id,
            category_id: split.category_id,
            amount: split.amount,
            note: split.note ?? null,
          })) }
        : undefined,
    },
    include: transactionInclude,
  });
  res.status(201).json(serializeTransaction(row));
}));

transactionsRouter.patch('/users/:user_id/transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateTransactionSchema.parse(req.body);
  const existing = await prisma.transaction.findFirst({ where: { id, user_id }, include: { splits: true } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await assertTransactionReferences(user_id, body);
  const next = {
    type: body.type ?? existing.type,
    account_id: body.account_id !== undefined ? body.account_id ?? null : existing.account_id,
    to_account_id: body.to_account_id !== undefined ? body.to_account_id ?? null : existing.to_account_id,
    category_id: body.category_id !== undefined ? body.category_id ?? null : existing.category_id,
    amount: body.amount ?? existing.amount,
    to_amount: body.to_amount !== undefined ? body.to_amount ?? null : existing.to_amount,
    date: body.date ?? existing.date.toISOString().slice(0, 10),
    refunds_transaction_id: body.refunds_transaction_id !== undefined
      ? body.refunds_transaction_id ?? null
      : existing.refunds_transaction_id,
  };
  const requestedSplits = body.splits !== undefined ? body.splits : undefined;
  const nextSplits = next.type === 'transfer' ? [] : requestedSplits;
  // The create schema validates source != destination via superRefine, but
  // the partial update schema can't (fields may be absent). We re-check on
  // the post-merge state so PATCH can't turn an existing transfer into a
  // self-transfer either.
  if (next.type === 'transfer') {
    if (!next.account_id || !next.to_account_id) {
      throw new HttpError(400, 'Un transfert exige un compte source et un compte destination');
    }
    if (next.account_id === next.to_account_id) {
      throw new HttpError(400, 'Les comptes source et destination doivent être différents');
    }
  }
  // Lien de remboursement : seul un revenu peut en porter un ; perdre le type
  // revenu détache le lien plutôt que de laisser une donnée incohérente.
  const refundsId = next.type === 'income' ? next.refunds_transaction_id : null;
  if (refundsId != null && body.refunds_transaction_id != null) {
    if (refundsId === id) {
      throw new HttpError(400, 'Une transaction ne peut pas se rembourser elle-même');
    }
    await assertRefundTarget(user_id, refundsId);
  }
  const transfer = await transferAmounts(user_id, next);
  if (nextSplits !== undefined) {
    await assertTransactionSplits(user_id, next.type, nextSplits, next.amount);
  } else if (existing.splits.length > 0) {
    await assertTransactionSplits(user_id, next.type, existing.splits, next.amount);
  }
  // Remplacement des tags + update de la ligne dans une même transaction DB :
  // un échec de l'update ne doit pas laisser la transaction sans ses tags.
  const tagOps = body.tag_ids !== undefined
    ? await resolveTagIds(user_id, body.tag_ids).then((tagIds) => [
        prisma.transactionTag.deleteMany({ where: { transaction_id: id } }),
        ...(tagIds.length > 0
          ? [prisma.transactionTag.createMany({ data: tagIds.map((tag_id) => ({ transaction_id: id, tag_id })) })]
          : []),
      ])
    : [];
  const splitOps = nextSplits !== undefined
    ? [
        prisma.transactionSplit.deleteMany({ where: { transaction_id: id } }),
        ...(nextSplits.length > 0
          ? [prisma.transactionSplit.createMany({
              data: nextSplits.map((split) => ({
                user_id,
                transaction_id: id,
                category_id: split.category_id,
                amount: split.amount,
                note: split.note ?? null,
              })),
            })]
          : []),
      ]
    : [];
  const results = await prisma.$transaction([
    ...tagOps,
    ...splitOps,
    prisma.transaction.update({
      where: { id },
      data: {
        ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
        // Un non-transfert ne garde jamais de compte destination (miroir du POST).
        to_account_id: next.type === 'transfer' ? next.to_account_id : null,
        ...(body.category_id !== undefined || nextSplits !== undefined || next.type === 'transfer'
          ? { category_id: (nextSplits && nextSplits.length > 0) || next.type === 'transfer' ? null : next.category_id }
          : {}),
        ...(body.amount != null ? { amount: body.amount } : {}),
        to_amount: transfer.toAmount,
        exchange_rate: transfer.exchangeRate,
        refunds_transaction_id: refundsId,
        ...(body.type != null ? { type: body.type } : {}),
        ...(body.date != null ? { date: new Date(body.date) } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      },
      include: transactionInclude,
    }),
  ]);
  const row = results[results.length - 1] as Parameters<typeof serializeTransaction>[0];
  res.json(serializeTransaction(row));
}));

transactionsRouter.post('/users/:user_id/transactions/:id/link-recurring', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = linkRecurringSchema.parse(req.body);
  const existing = await prisma.transaction.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (body.recurring_transaction_id == null) {
    const row = await prisma.transaction.update({
      where: { id },
      data: { recurring_transaction_id: null },
      include: transactionInclude,
    });
    res.json(serializeTransaction(row));
    return;
  }
  const recurring = await prisma.recurringTransaction.findFirst({
    where: { id: body.recurring_transaction_id, user_id },
  });
  if (!recurring) {
    res.status(404).json({ error: 'Recurring transaction not found' });
    return;
  }
  const data = {
    recurring_transaction_id: recurring.id,
    ...(body.sync_description ? { description: recurring.description } : {}),
    ...(body.sync_amount ? { amount: recurring.amount } : {}),
    ...(body.sync_category_account ? {
      account_id: recurring.account_id,
      category_id: recurring.category_id,
      type: recurring.type,
      to_account_id: null,
      to_amount: null,
      exchange_rate: null,
    } : {}),
  };
  const results = await prisma.$transaction([
    ...(body.sync_category_account ? [prisma.transactionSplit.deleteMany({ where: { transaction_id: id } })] : []),
    prisma.transaction.update({ where: { id }, data, include: transactionInclude }),
  ]);
  const row = results[results.length - 1] as Parameters<typeof serializeTransaction>[0];
  res.json(serializeTransaction(row));
}));

transactionsRouter.delete('/users/:user_id/transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.transaction.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));

// Modification en masse (compte et/ou catégorie) : un seul aller-retour au lieu
// d'un PATCH par ligne depuis l'édition groupée du tableau des transactions.
const bulkUpdateSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
  account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
});

transactionsRouter.post('/users/:user_id/transactions/bulk-update', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = bulkUpdateSchema.parse(req.body);
  if (body.account_id === undefined && body.category_id === undefined) {
    throw new HttpError(400, 'Aucun champ à modifier');
  }
  await assertTransactionReferences(user_id, body);
  const result = await prisma.transaction.updateMany({
    where: { id: { in: body.ids }, user_id },
    data: {
      ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
      ...(body.category_id !== undefined ? { category_id: body.category_id ?? null } : {}),
    },
  });
  res.json({ updated: result.count });
}));

function nextMonth(month: string): string {
  const [yearRaw, monthRaw] = month.split('-');
  const date = new Date(Date.UTC(Number(yearRaw), Number(monthRaw), 1));
  return date.toISOString();
}

export function serializeTransaction(row: {
  id: number;
  user_id: number;
  account_id: number | null;
  to_account_id: number | null;
  category_id: number | null;
  recurring_transaction_id: number | null;
  refunds_transaction_id?: number | null;
  amount: number;
  to_amount: number | null;
  exchange_rate: number | null;
  type: string;
  date: Date;
  description: string | null;
  created_at: Date;
  tags: Array<{ tag: { id: number; user_id: number; name: string; color: string; created_at: Date } }>;
  splits: Array<{ id: number; user_id: number; transaction_id: number; category_id: number; amount: number; note: string | null; created_at: Date }>;
  refunded_by?: Array<{ id: number; amount: number; date: Date }>;
  refunds_transaction?: { id: number; amount: number; date: Date; description: string | null } | null;
}) {
  return {
    ...row,
    tags: row.tags.map((join) => join.tag),
    splits: row.splits.map((split) => ({ ...split, created_at: split.created_at.toISOString() })),
    refunded_by: (row.refunded_by ?? []).map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) })),
    refunds_transaction: row.refunds_transaction
      ? { ...row.refunds_transaction, date: row.refunds_transaction.date.toISOString().slice(0, 10) }
      : null,
  };
}
