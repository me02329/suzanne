import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createBillSchema, idParam, monthString, updateBillSchema } from '../lib/validation.js';
import { assertTransactionReferences } from '../lib/transactionHelpers.js';
import { billStatusForMonth } from '../lib/bills.js';
import { round2 } from '../lib/money.js';

export const billsRouter = Router();

billsRouter.get('/users/:user_id/bills', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.bill.findMany({ where: { user_id }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }));
}));

// Statut des factures sur un mois : chaque facture est rapprochée des dépenses
// du mois (une seule requête transactions, le match se fait en mémoire).
// Les factures hors cadence ou inactives sortent en `not_due` pour que le
// frontend puisse les afficher en grisé plutôt que les faire disparaître.
billsRouter.get('/users/:user_id/bills/status', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.query.month);
  const [bills, transactions, manualMatches] = await Promise.all([
    prisma.bill.findMany({ where: { user_id }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    prisma.transaction.findMany({
      where: {
        user_id,
        type: 'expense',
        date: { gte: new Date(`${month}-01T00:00:00.000Z`), lt: nextMonthStart(month) },
      },
      select: { id: true, type: true, amount: true, date: true, description: true, account_id: true, category_id: true },
    }),
    prisma.billMatch.findMany({ where: { user_id }, select: { bill_id: true, transaction_id: true } }),
  ]);
  // Liens manuels groupés par facture (ne comptent que pour le mois où tombe
  // la dépense liée, ce qui est géré par le filtrage de `transactions`).
  const manualByBill = new Map<number, Set<number>>();
  for (const match of manualMatches) {
    const set = manualByBill.get(match.bill_id) ?? new Set<number>();
    set.add(match.transaction_id);
    manualByBill.set(match.bill_id, set);
  }
  const today = new Date();
  const entries = bills.map((bill) => ({
    bill: { ...bill, start_date: bill.start_date.toISOString().slice(0, 10) },
    ...billStatusForMonth(bill, transactions, month, today, manualByBill.get(bill.id) ?? new Set()),
  }));
  const due = entries.filter((entry) => entry.due);
  res.json({
    month,
    due_count: due.length,
    paid_count: due.filter((entry) => entry.paid_amount > 0).length,
    expected_total: round2(due.reduce((sum, entry) => sum + (entry.bill.amount_min + entry.bill.amount_max) / 2, 0)),
    paid_total: round2(due.reduce((sum, entry) => sum + entry.paid_amount, 0)),
    bills: entries,
  });
}));

billsRouter.post('/users/:user_id/bills', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createBillSchema.parse(req.body);
  await assertTransactionReferences(user_id, body);
  const row = await prisma.bill.create({
    data: {
      user_id,
      name: body.name,
      amount_min: body.amount_min,
      amount_max: body.amount_max,
      start_date: new Date(body.start_date),
      frequency: body.frequency,
      interval: body.interval,
      pattern: body.pattern?.trim() || null,
      account_id: body.account_id ?? null,
      category_id: body.category_id ?? null,
      active: body.active,
    },
  });
  res.status(201).json(row);
}));

billsRouter.patch('/users/:user_id/bills/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateBillSchema.parse(req.body);
  const existing = await prisma.bill.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await assertTransactionReferences(user_id, body);
  // La fourchette est validée champ à champ par le schéma ; on re-vérifie sur
  // l'état fusionné pour qu'un PATCH partiel ne puisse pas l'inverser.
  const nextMin = body.amount_min ?? existing.amount_min;
  const nextMax = body.amount_max ?? existing.amount_max;
  if (nextMin > nextMax) {
    res.status(400).json({ error: 'La fourchette est inversée : le minimum dépasse le maximum' });
    return;
  }
  const row = await prisma.bill.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.amount_min != null ? { amount_min: body.amount_min } : {}),
      ...(body.amount_max != null ? { amount_max: body.amount_max } : {}),
      ...(body.start_date != null ? { start_date: new Date(body.start_date) } : {}),
      ...(body.frequency != null ? { frequency: body.frequency } : {}),
      ...(body.interval != null ? { interval: body.interval } : {}),
      ...(body.pattern !== undefined ? { pattern: body.pattern?.trim() || null } : {}),
      ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
      ...(body.category_id !== undefined ? { category_id: body.category_id ?? null } : {}),
      ...(body.active != null ? { active: body.active } : {}),
    },
  });
  res.json(row);
}));

// Lier manuellement une dépense à une facture (rapprochement hors motif).
billsRouter.post('/users/:user_id/bills/:id/matches', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const bill_id = idParam.parse(req.params.id);
  const { transaction_id } = z.object({ transaction_id: z.coerce.number().int().positive() }).parse(req.body);
  const [bill, tx] = await Promise.all([
    prisma.bill.findFirst({ where: { id: bill_id, user_id }, select: { id: true } }),
    prisma.transaction.findFirst({ where: { id: transaction_id, user_id }, select: { id: true, type: true } }),
  ]);
  if (!bill) throw new HttpError(404, 'Facture introuvable');
  if (!tx) throw new HttpError(400, 'Transaction introuvable');
  if (tx.type !== 'expense') throw new HttpError(400, 'Seule une dépense peut être liée à une facture');
  const row = await prisma.billMatch.upsert({
    where: { bill_id_transaction_id: { bill_id, transaction_id } },
    create: { user_id, bill_id, transaction_id },
    update: {},
  });
  res.status(201).json(row);
}));

billsRouter.delete('/users/:user_id/bills/:id/matches/:transaction_id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const bill_id = idParam.parse(req.params.id);
  const transaction_id = idParam.parse(req.params.transaction_id);
  const result = await prisma.billMatch.deleteMany({ where: { user_id, bill_id, transaction_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Lien introuvable' });
    return;
  }
  res.json({ deleted: true });
}));

billsRouter.delete('/users/:user_id/bills/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.bill.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));

function nextMonthStart(month: string): Date {
  const [yearRaw, monthRaw] = month.split('-');
  return new Date(Date.UTC(Number(yearRaw), Number(monthRaw), 1));
}
