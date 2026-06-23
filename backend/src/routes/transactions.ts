import { Router } from 'express';
import { z } from 'zod';
import { prisma, prismaBase } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createTransactionSchema, dateString, idParam, linkRecurringSchema, monthString, updateTransactionSchema } from '../lib/validation.js';
import {
  assertRefundTarget,
  assertTransactionReferences,
  assertTransactionSplits,
  resolveRefundAllocations,
  resolveTagIds,
  transferAmounts,
} from '../lib/transactionHelpers.js';

export const transactionsRouter = Router();

// Relations embarquées dans chaque transaction renvoyée : les remboursements
// reçus (sur une dépense) et un aperçu de la dépense remboursée (sur un revenu).
export const transactionInclude = {
  tags: { include: { tag: true } },
  splits: { orderBy: { id: 'asc' as const } },
  refund_allocations_sent: {
    orderBy: { id: 'asc' as const },
    include: {
      expense_transaction: { select: { id: true, amount: true, date: true, description: true } },
    },
  },
  refund_allocations_received: {
    orderBy: { id: 'asc' as const },
    include: {
      refund_transaction: { select: { id: true, amount: true, date: true } },
    },
  },
  refunded_by: { select: { id: true, amount: true, date: true }, orderBy: { date: 'asc' as const } },
  refunds_transaction: { select: { id: true, amount: true, date: true, description: true } },
};

transactionsRouter.get('/users/:user_id/transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = req.query.month ? monthString.parse(req.query.month) : null;
  const issue = req.query.issue ? z.enum(['unassigned_account']).parse(req.query.issue) : null;
  // Filtres optionnels (liaison de remboursements, drill-down depuis les
  // pages de visualisation : catégorie/marchand sur une plage de dates).
  const type = req.query.type ? z.enum(['expense', 'income', 'transfer']).parse(req.query.type) : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const categoryId = req.query.category_id ? z.coerce.number().int().positive().parse(req.query.category_id) : null;
  const from = req.query.from ? dateString.parse(req.query.from) : null;
  const to = req.query.to ? dateString.parse(req.query.to) : null;
  const limit = req.query.limit ? z.coerce.number().int().min(1).max(100).parse(req.query.limit) : null;
  // Le mois (vue par défaut) a priorité ; sinon une plage from/to libre.
  const dateFilter = month
    ? { gte: new Date(`${month}-01T00:00:00.000Z`), lt: new Date(nextMonth(month)) }
    : (from || to)
      ? {
          ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
          ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
        }
      : null;
  const rows = await prisma.transaction.findMany({
    where: {
      user_id,
      ...(dateFilter ? { date: dateFilter } : {}),
      ...(issue === 'unassigned_account' ? { type: { not: 'transfer' as const }, account_id: null } : {}),
      ...(type ? { type } : {}),
      ...(q ? { description: { contains: q, mode: 'insensitive' as const } } : {}),
      // Une transaction ventilée appartient à chaque catégorie de ses splits.
      ...(categoryId ? { OR: [{ category_id: categoryId }, { splits: { some: { category_id: categoryId } } }] } : {}),
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
  const refundAllocations = body.type === 'income'
    ? await resolveRefundAllocations(
        user_id,
        null,
        body.type,
        body.amount,
        body.refund_allocations ?? (body.refunds_transaction_id != null
          ? [{ expense_transaction_id: body.refunds_transaction_id, amount: body.amount }]
          : undefined),
      )
    : [];
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
      cleared: body.cleared ?? false,
      tags: { create: tagIds.map((tag_id) => ({ tag_id })) },
      refund_allocations_sent: refundAllocations.length > 0
        ? { create: refundAllocations.map((allocation) => ({
            user_id,
            expense_transaction_id: allocation.expense_transaction_id,
            amount: allocation.amount,
          })) }
        : undefined,
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
  const existing = await prisma.transaction.findFirst({
    where: { id, user_id },
    include: { splits: true, refund_allocations_sent: true },
  });
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
  const requestedRefundAllocations = body.refund_allocations !== undefined
    ? body.refund_allocations
    : body.refunds_transaction_id !== undefined
      ? body.refunds_transaction_id == null ? [] : [{ expense_transaction_id: body.refunds_transaction_id, amount: next.amount }]
      : undefined;
  const nextRefundAllocations = next.type === 'income' ? requestedRefundAllocations : [];
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
  if (nextRefundAllocations !== undefined) {
    await resolveRefundAllocations(user_id, id, next.type, next.amount, nextRefundAllocations);
  } else if (existing.refund_allocations_sent.length > 0) {
    await resolveRefundAllocations(user_id, id, next.type, next.amount, existing.refund_allocations_sent);
  }
  const transfer = await transferAmounts(user_id, next);
  if (nextSplits !== undefined) {
    await assertTransactionSplits(user_id, next.type, nextSplits, next.amount);
  } else if (existing.splits.length > 0) {
    await assertTransactionSplits(user_id, next.type, existing.splits, next.amount);
  }
  const legacyRefundsId = next.type !== 'income'
    ? null
    : body.refunds_transaction_id !== undefined
      ? refundsId
      : body.refund_allocations !== undefined
        ? null
        : existing.refunds_transaction_id;
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
  const refundAllocationOps = nextRefundAllocations !== undefined
    ? [
        prisma.refundAllocation.deleteMany({ where: { refund_transaction_id: id } }),
        ...(nextRefundAllocations.length > 0
          ? [prisma.refundAllocation.createMany({
              data: nextRefundAllocations.map((allocation) => ({
                user_id,
                refund_transaction_id: id,
                expense_transaction_id: allocation.expense_transaction_id,
                amount: allocation.amount,
              })),
            })]
          : []),
      ]
    : [];
  const results = await prisma.$transaction([
    ...tagOps,
    ...splitOps,
    ...refundAllocationOps,
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
        refunds_transaction_id: legacyRefundsId,
        ...(body.type != null ? { type: body.type } : {}),
        ...(body.date != null ? { date: new Date(body.date) } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(body.cleared != null ? { cleared: body.cleared } : {}),
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

// Soft-delete : la transaction part en corbeille (deleted_at) et reste
// restaurable. Les relations (splits, tags, remboursements) sont conservées.
transactionsRouter.delete('/users/:user_id/transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prismaBase.transaction.updateMany({ where: { id, user_id, deleted_at: null }, data: { deleted_at: new Date() } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));

// Corbeille : transactions supprimées (lecture via prismaBase pour contourner
// le filtre soft-delete).
transactionsRouter.get('/users/:user_id/transactions/trash', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const rows = await prismaBase.transaction.findMany({
    where: { user_id, deleted_at: { not: null } },
    include: transactionInclude,
    orderBy: { deleted_at: 'desc' },
    take: 200,
  });
  res.json(rows.map(serializeTransaction));
}));

transactionsRouter.post('/users/:user_id/transactions/:id/restore', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prismaBase.transaction.updateMany({ where: { id, user_id, deleted_at: { not: null } }, data: { deleted_at: null } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Transaction introuvable dans la corbeille' });
    return;
  }
  res.json({ restored: true });
}));

// Purge définitive d'une transaction de la corbeille (irréversible).
transactionsRouter.delete('/users/:user_id/transactions/:id/purge', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prismaBase.transaction.deleteMany({ where: { id, user_id, deleted_at: { not: null } } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Transaction introuvable dans la corbeille' });
    return;
  }
  res.json({ purged: true });
}));

// Modification en masse (compte et/ou catégorie) : un seul aller-retour au lieu
// d'un PATCH par ligne depuis l'édition groupée du tableau des transactions.
const bulkUpdateSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
  account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  cleared: z.coerce.boolean().optional(),
  // Ajout/retrait d'un tag sur toute la sélection (table de jointure).
  add_tag_id: z.coerce.number().int().positive().optional(),
  remove_tag_id: z.coerce.number().int().positive().optional(),
});

transactionsRouter.post('/users/:user_id/transactions/bulk-update', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = bulkUpdateSchema.parse(req.body);
  if (body.account_id === undefined && body.category_id === undefined && body.cleared === undefined
    && body.add_tag_id === undefined && body.remove_tag_id === undefined) {
    throw new HttpError(400, 'Aucun champ à modifier');
  }
  await assertTransactionReferences(user_id, body);
  // Les tags fournis doivent appartenir à l'utilisateur (même garde que la
  // saisie unitaire) ; un id étranger est ignoré silencieusement.
  const tagIds = await resolveTagIds(user_id, [body.add_tag_id, body.remove_tag_id].filter((id): id is number => id != null));
  const ownedAddTag = body.add_tag_id != null && tagIds.includes(body.add_tag_id);
  const ownedRemoveTag = body.remove_tag_id != null && tagIds.includes(body.remove_tag_id);
  // Une transaction ventilée ne porte pas de catégorie propre : un changement
  // de catégorie en masse l'ignore (ses splits font foi). Le changement de
  // compte seul, lui, reste applicable aux transactions ventilées.
  const scalarUpdate = body.account_id !== undefined || body.category_id !== undefined || body.cleared !== undefined;
  // Les liens de tag visent la même fenêtre de sélection, restreinte aux
  // transactions de l'utilisateur (isolation : on ne taggue jamais hors scope).
  const ownedIds = (ownedAddTag || ownedRemoveTag)
    ? (await prisma.transaction.findMany({ where: { id: { in: body.ids }, user_id }, select: { id: true } })).map((row) => row.id)
    : [];
  const [updateResult] = await prisma.$transaction([
    prisma.transaction.updateMany({
      where: {
        id: { in: body.ids },
        user_id,
        ...(body.category_id !== undefined ? { splits: { none: {} } } : {}),
      },
      data: {
        ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
        ...(body.category_id !== undefined ? { category_id: body.category_id ?? null } : {}),
        ...(body.cleared !== undefined ? { cleared: body.cleared } : {}),
      },
    }),
    ...(ownedAddTag
      ? [prisma.transactionTag.createMany({
          data: ownedIds.map((transaction_id) => ({ transaction_id, tag_id: body.add_tag_id! })),
          skipDuplicates: true,
        })]
      : []),
    ...(ownedRemoveTag
      ? [prisma.transactionTag.deleteMany({ where: { transaction_id: { in: ownedIds }, tag_id: body.remove_tag_id! } })]
      : []),
  ]);
  // « updated » reflète la portée touchée : lignes mises à jour pour un champ
  // scalaire, sinon le nombre de lignes ciblées par l'opération de tag.
  res.json({ updated: scalarUpdate ? updateResult.count : ownedIds.length });
}));

transactionsRouter.post('/users/:user_id/transactions/bulk-delete', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(500) }).parse(req.body);
  // Soft-delete groupé (corbeille).
  const result = await prismaBase.transaction.updateMany({ where: { id: { in: body.ids }, user_id, deleted_at: null }, data: { deleted_at: new Date() } });
  res.json({ deleted: result.count });
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
  cleared: boolean;
  created_at: Date;
  tags: Array<{ tag: { id: number; user_id: number; name: string; color: string; created_at: Date } }>;
  splits: Array<{ id: number; user_id: number; transaction_id: number; category_id: number; amount: number; note: string | null; created_at: Date }>;
  refund_allocations_sent: Array<{
    id: number;
    user_id: number;
    refund_transaction_id: number;
    expense_transaction_id: number;
    amount: number;
    created_at: Date;
    expense_transaction: { id: number; amount: number; date: Date; description: string | null };
  }>;
  refund_allocations_received: Array<{
    id: number;
    amount: number;
    refund_transaction: { id: number; amount: number; date: Date };
  }>;
  refunded_by?: Array<{ id: number; amount: number; date: Date }>;
  refunds_transaction?: { id: number; amount: number; date: Date; description: string | null } | null;
}) {
  const allocationRefunds = row.refund_allocations_received.map((allocation) => ({
    id: allocation.refund_transaction.id,
    amount: allocation.amount,
    date: allocation.refund_transaction.date.toISOString().slice(0, 10),
  }));
  const seenRefundIds = new Set(allocationRefunds.map((refund) => refund.id));
  const legacyRefunds = (row.refunded_by ?? [])
    .filter((refund) => !seenRefundIds.has(refund.id))
    .map((refund) => ({ ...refund, date: refund.date.toISOString().slice(0, 10) }));
  const refundAllocations = row.refund_allocations_sent.map((allocation) => ({
    id: allocation.id,
    user_id: allocation.user_id,
    refund_transaction_id: allocation.refund_transaction_id,
    expense_transaction_id: allocation.expense_transaction_id,
    amount: allocation.amount,
    created_at: allocation.created_at.toISOString(),
    expense_transaction: {
      ...allocation.expense_transaction,
      date: allocation.expense_transaction.date.toISOString().slice(0, 10),
    },
  }));
  return {
    ...row,
    tags: row.tags.map((join) => join.tag),
    splits: row.splits.map((split) => ({ ...split, created_at: split.created_at.toISOString() })),
    refund_allocations: refundAllocations,
    refund_allocations_sent: undefined,
    refund_allocations_received: undefined,
    refunded_by: [...allocationRefunds, ...legacyRefunds].sort((a, b) => a.date.localeCompare(b.date)),
    refunds_transaction: refundAllocations.length === 1
      ? {
          ...refundAllocations[0]!.expense_transaction!,
          date: refundAllocations[0]!.expense_transaction!.date,
        }
      : row.refunds_transaction
        ? { ...row.refunds_transaction, date: row.refunds_transaction.date.toISOString().slice(0, 10) }
        : null,
  };
}
