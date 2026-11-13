import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, prismaBase } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createTransactionSchema, dateString, idParam, linkRecurringSchema, monthString, updateTransactionSchema } from '../lib/validation.js';
import { resolveTagIds } from '../lib/transactionHelpers.js';
import { buildLines, legacyView, LINES_ORDERED, linesCreateData, mergeLegacy, patchTouchesLines, type LegacyInput } from '../lib/ledger.js';
import { round2 } from '../lib/money.js';

export const transactionsRouter = Router();

// Relations embarquées dans chaque opération renvoyée : lignes, tags, et les
// remboursements (reçus sur une dépense / dépense remboursée par un revenu).
const refundPeek = {
  select: {
    id: true,
    date: true,
    description: true,
    deleted_at: true,
    lines: { select: { amount: true, refund: true } },
  },
} as const;
export const transactionInclude = {
  lines: { ...LINES_ORDERED, include: { refund_of: refundPeek } },
  tags: { include: { tag: true } },
  // Lignes d'autres opérations qui remboursent celle-ci.
  refund_lines: { select: { amount: true, transaction: { select: { id: true, date: true, deleted_at: true } } } },
  refunds_transaction: refundPeek,
} satisfies Prisma.TransactionInclude;

type TxRow = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;

const peekSpent = (lines: Array<{ amount: number }>) => round2(Math.abs(lines.reduce((s, l) => s + l.amount, 0)));

// Forme renvoyée : en-tête + lignes + vue historique dérivée des lignes
// (type, amount, account_id, to_account_id, to_amount, category_id, splits),
// pour que les écrans existants restent compatibles.
export function serializeTransaction(row: TxRow) {
  const view = legacyView(row);
  const { refund_lines, refunds_transaction, tags, lines, ...header } = row;
  const target = refunds_transaction && !refunds_transaction.deleted_at ? refunds_transaction : null;
  const peek = (t: { id: number; date: Date; description: string | null; lines: Array<{ amount: number }> }) =>
    ({ id: t.id, amount: peekSpent(t.lines), date: t.date.toISOString().slice(0, 10), description: t.description });
  // Remboursements portés par cette opération, regroupés par dépense remboursée.
  const allocations = new Map<number, { expense_transaction_id: number; amount: number; expense_transaction: ReturnType<typeof peek> }>();
  for (const l of lines) {
    if (!l.refund) continue;
    const expense = l.refund_of && !l.refund_of.deleted_at ? l.refund_of : !l.refund_of_id ? target : null;
    if (!expense) continue;
    const current = allocations.get(expense.id) ?? { expense_transaction_id: expense.id, amount: 0, expense_transaction: peek(expense) };
    current.amount += l.amount;
    allocations.set(expense.id, current);
  }
  // Remboursements reçus par cette dépense, regroupés par opération.
  const received = new Map<number, { id: number; amount: number; date: string }>();
  for (const l of refund_lines) {
    if (l.transaction.deleted_at) continue;
    const r = received.get(l.transaction.id) ?? { id: l.transaction.id, amount: 0, date: l.transaction.date.toISOString().slice(0, 10) };
    r.amount += l.amount;
    received.set(l.transaction.id, r);
  }
  return {
    ...header,
    ...view,
    lines: lines.map((l) => ({ id: l.id, account_id: l.account_id, category_id: l.category_id, amount: l.amount, refund: l.refund, refund_of_id: l.refund_of_id, note: l.note })),
    tags: tags.map((join) => join.tag),
    refunded_by: Array.from(received.values()).map((r) => ({ ...r, amount: round2(r.amount) })).sort((x, y) => x.date.localeCompare(y.date)),
    refunds_transaction: target ? peek(target) : null,
    refund_allocations: Array.from(allocations.values()).map((x) => ({ ...x, amount: round2(x.amount) })),
  };
}

transactionsRouter.get('/users/:user_id/transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = req.query.month ? monthString.parse(req.query.month) : null;
  const issue = req.query.issue ? z.enum(['unassigned_account']).parse(req.query.issue) : null;
  const type = req.query.type ? z.enum(['expense', 'income', 'transfer']).parse(req.query.type) : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const categoryId = req.query.category_id ? z.coerce.number().int().positive().parse(req.query.category_id) : null;
  const accountId = req.query.account_id ? z.coerce.number().int().positive().parse(req.query.account_id) : null;
  const from = req.query.from ? dateString.parse(req.query.from) : null;
  const to = req.query.to ? dateString.parse(req.query.to) : null;
  const limit = req.query.limit ? z.coerce.number().int().min(1).max(100).parse(req.query.limit) : null;
  const dateFilter = month
    ? { gte: new Date(`${month}-01T00:00:00.000Z`), lt: new Date(nextMonth(month)) }
    : (from || to)
      ? {
          ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
          ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
        }
      : null;
  const lineFilters: Prisma.TransactionWhereInput[] = [];
  if (issue === 'unassigned_account') lineFilters.push({ kind: 'standard', lines: { some: { account_id: null } } });
  if (categoryId) lineFilters.push({ lines: { some: { category_id: categoryId } } });
  if (accountId) lineFilters.push({ lines: { some: { account_id: accountId } } });
  const rows = await prisma.transaction.findMany({
    where: {
      user_id,
      ...(dateFilter ? { date: dateFilter } : {}),
      ...(type === 'transfer' ? { kind: 'transfer' as const } : type ? { kind: 'standard' as const } : {}),
      ...(q ? { description: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(lineFilters.length > 0 ? { AND: lineFilters } : {}),
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    include: transactionInclude,
    // Le filtre dépense/revenu se fait sur la vue dérivée : on ne peut pas
    // limiter en SQL dans ce cas.
    ...(limit && !(type === 'expense' || type === 'income') ? { take: limit } : {}),
  });
  let out = rows.map(serializeTransaction);
  if (type === 'expense' || type === 'income') {
    out = out.filter((t) => t.type === type);
    if (limit) out = out.slice(0, limit);
  }
  res.json(out);
}));

transactionsRouter.post('/users/:user_id/transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createTransactionSchema.parse(req.body);
  const built = await buildLines(prisma, user_id, body as LegacyInput);
  const tagIds = await resolveTagIds(user_id, body.tag_ids);
  const row = await prisma.transaction.create({
    data: {
      user_id,
      kind: built.kind,
      refunds_transaction_id: built.refunds_transaction_id,
      date: new Date(body.date),
      description: body.description ?? null,
      cleared: body.cleared ?? false,
      lines: { create: linesCreateData(user_id, built) },
      tags: { create: tagIds.map((tag_id) => ({ tag_id })) },
    },
    include: transactionInclude,
  });
  res.status(201).json(serializeTransaction(row));
}));

transactionsRouter.patch('/users/:user_id/transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateTransactionSchema.parse(req.body);
  const existing = await prisma.transaction.findFirst({ where: { id, user_id }, include: { lines: LINES_ORDERED } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (existing.kind === 'trade') throw new HttpError(400, 'Ce mouvement provient d\'un ordre de bourse : modifie l\'ordre');
  const patch = body as Partial<LegacyInput>;
  // Les lignes ne sont reconstruites que si la modification touche aux
  // montants : un changement de libellé ou de pointage les laisse intactes.
  const built = patchTouchesLines(patch) ? await buildLines(prisma, user_id, mergeLegacy(existing, patch), id) : null;
  const tagIds = body.tag_ids !== undefined ? await resolveTagIds(user_id, body.tag_ids) : null;
  const row = await prisma.$transaction(async (tx) => {
    if (built) {
      await tx.transactionLine.deleteMany({ where: { transaction_id: id } });
      await tx.transactionLine.createMany({ data: linesCreateData(user_id, built).map((l) => ({ ...l, transaction_id: id })) });
    }
    if (tagIds) {
      await tx.transactionTag.deleteMany({ where: { transaction_id: id } });
      if (tagIds.length > 0) await tx.transactionTag.createMany({ data: tagIds.map((tag_id) => ({ transaction_id: id, tag_id })) });
    }
    return tx.transaction.update({
      where: { id },
      data: {
        ...(built ? { kind: built.kind, refunds_transaction_id: built.refunds_transaction_id } : {}),
        ...(body.date != null ? { date: new Date(body.date) } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(body.cleared != null ? { cleared: body.cleared } : {}),
      },
      include: transactionInclude,
    });
  });
  res.json(serializeTransaction(row));
}));

transactionsRouter.post('/users/:user_id/transactions/:id/link-recurring', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = linkRecurringSchema.parse(req.body);
  const existing = await prisma.transaction.findFirst({ where: { id, user_id }, include: { lines: LINES_ORDERED } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (body.recurring_transaction_id == null) {
    const row = await prisma.transaction.update({ where: { id }, data: { recurring_transaction_id: null }, include: transactionInclude });
    res.json(serializeTransaction(row));
    return;
  }
  const recurring = await prisma.recurringTransaction.findFirst({ where: { id: body.recurring_transaction_id, user_id } });
  if (!recurring) {
    res.status(404).json({ error: 'Recurring transaction not found' });
    return;
  }
  const view = legacyView(existing);
  const built = body.sync_category_account || body.sync_amount
    ? await buildLines(prisma, user_id, {
        type: body.sync_category_account ? recurring.type : view.type,
        amount: body.sync_amount ? recurring.amount : view.amount,
        account_id: body.sync_category_account ? recurring.account_id : view.account_id,
        to_account_id: body.sync_category_account ? null : view.to_account_id,
        to_amount: body.sync_category_account || body.sync_amount ? null : view.to_amount,
        category_id: body.sync_category_account ? recurring.category_id : view.category_id,
        date: existing.date.toISOString().slice(0, 10),
      }, id)
    : null;
  const row = await prisma.$transaction(async (tx) => {
    if (built) {
      await tx.transactionLine.deleteMany({ where: { transaction_id: id } });
      await tx.transactionLine.createMany({ data: linesCreateData(user_id, built).map((l) => ({ ...l, transaction_id: id })) });
    }
    return tx.transaction.update({
      where: { id },
      data: {
        recurring_transaction_id: recurring.id,
        ...(built ? { kind: built.kind, refunds_transaction_id: built.refunds_transaction_id } : {}),
        ...(body.sync_description ? { description: recurring.description } : {}),
      },
      include: transactionInclude,
    });
  });
  res.json(serializeTransaction(row));
}));

// Soft-delete : l'opération part en corbeille (deleted_at) et reste restaurable.
transactionsRouter.delete('/users/:user_id/transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prismaBase.transaction.updateMany({ where: { id, user_id, deleted_at: null, kind: { not: 'trade' } }, data: { deleted_at: new Date() } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));

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

// Modification en masse (compte, catégorie, pointage, tags).
const bulkUpdateSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
  account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  cleared: z.coerce.boolean().optional(),
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
  if (body.account_id != null && !(await prisma.account.findFirst({ where: { id: body.account_id, user_id }, select: { id: true } }))) {
    throw new HttpError(400, 'Compte introuvable');
  }
  if (body.category_id != null && !(await prisma.category.findFirst({ where: { id: body.category_id, user_id }, select: { id: true } }))) {
    throw new HttpError(400, 'Catégorie introuvable');
  }
  const tagIds = await resolveTagIds(user_id, [body.add_tag_id, body.remove_tag_id].filter((x): x is number => x != null));
  const ownedAddTag = body.add_tag_id != null && tagIds.includes(body.add_tag_id);
  const ownedRemoveTag = body.remove_tag_id != null && tagIds.includes(body.remove_tag_id);
  const targets = await prisma.transaction.findMany({
    where: { id: { in: body.ids }, user_id },
    select: { id: true, kind: true, lines: { select: { id: true, amount: true, account_id: true } } },
  });
  const ids = targets.map((t) => t.id);
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    if (body.account_id !== undefined) {
      // Dépense/revenu : toutes ses lignes. Virement : la ligne source, sauf si
      // elle deviendrait identique à la destination.
      const lineIds = targets.flatMap((t) => {
        if (t.kind === 'standard') return t.lines.map((l) => l.id);
        if (t.kind !== 'transfer' || body.account_id == null) return [];
        const src = t.lines.find((l) => l.amount < 0);
        const dst = t.lines.find((l) => l.amount >= 0);
        return src && dst?.account_id !== body.account_id ? [src.id] : [];
      });
      await tx.transactionLine.updateMany({ where: { id: { in: lineIds } }, data: { account_id: body.account_id ?? null } });
      updated = Math.max(updated, new Set(targets.filter((t) => t.lines.some((l) => lineIds.includes(l.id))).map((t) => t.id)).size);
    }
    if (body.category_id !== undefined) {
      // Une opération ventilée (plusieurs lignes) garde sa ventilation.
      const single = targets.filter((t) => t.kind === 'standard' && t.lines.length === 1);
      await tx.transactionLine.updateMany({ where: { id: { in: single.map((t) => t.lines[0]!.id) } }, data: { category_id: body.category_id ?? null } });
      updated = Math.max(updated, single.length);
    }
    if (body.cleared !== undefined) {
      const r = await tx.transaction.updateMany({ where: { id: { in: ids } }, data: { cleared: body.cleared } });
      updated = Math.max(updated, r.count);
    }
    if (ownedAddTag) {
      await tx.transactionTag.createMany({ data: ids.map((transaction_id) => ({ transaction_id, tag_id: body.add_tag_id! })), skipDuplicates: true });
      updated = Math.max(updated, ids.length);
    }
    if (ownedRemoveTag) {
      await tx.transactionTag.deleteMany({ where: { transaction_id: { in: ids }, tag_id: body.remove_tag_id! } });
      updated = Math.max(updated, ids.length);
    }
  });
  res.json({ updated });
}));

transactionsRouter.post('/users/:user_id/transactions/bulk-delete', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(500) }).parse(req.body);
  const result = await prismaBase.transaction.updateMany({
    where: { id: { in: body.ids }, user_id, deleted_at: null, kind: { not: 'trade' } },
    data: { deleted_at: new Date() },
  });
  res.json({ deleted: result.count });
}));

function nextMonth(month: string): string {
  const [yearRaw, monthRaw] = month.split('-');
  const date = new Date(Date.UTC(Number(yearRaw), Number(monthRaw), 1));
  return date.toISOString();
}

// Une opération (lien direct ?tx=<id>). Déclarée après /transactions/trash pour
// que « trash » ne soit pas pris pour un id.
transactionsRouter.get('/users/:user_id/transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const row = await prisma.transaction.findFirst({ where: { id, user_id }, include: transactionInclude });
  if (!row) throw new HttpError(404, 'Opération introuvable');
  res.json(serializeTransaction(row));
}));
