import { Router } from 'express';
import { z } from 'zod';
import { prisma, prismaBase } from '../prisma.js';
import { resyncAccountOrders } from '../lib/holdingCash.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createAccountSchema, idParam, updateAccountSchema, investmentAccountFields } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { serializeTransaction, transactionInclude } from './transactions.js';

export const accountsRouter = Router();

accountsRouter.get('/users/:user_id/accounts', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.account.findMany({ where: { user_id }, orderBy: { name: 'asc' } }));
}));

// Activity for one account: all-time inflow/outflow totals + the most recent
// movements. Replaces the account detail page fetching every user transaction
// and filtering client-side — here the query is scoped to the account's lines
// (indexed on account_id) and only `limit` operations cross the wire.
accountsRouter.get('/users/:user_id/accounts/:id/activity', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const limit = z.coerce.number().int().min(1).max(200).default(40).parse(req.query.limit ?? 40);

  const account = await prisma.account.findFirst({ where: { id, user_id }, select: { id: true, initial_balance: true, initial_balance_date: true } });
  if (!account) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Les totaux lisent toutes les lignes du compte en projection minimale
  // (corbeille filtrée explicitement : relation imbriquée) ; seules les
  // `limit` opérations renvoyées embarquent tags et liens.
  const [lines, recent, latestSnapshot] = await Promise.all([
    prisma.transactionLine.findMany({
      where: { user_id, account_id: id, transaction: { deleted_at: null } },
      select: { amount: true, transaction_id: true, transaction: { select: { date: true, cleared: true } } },
    }),
    prisma.transaction.findMany({
      where: { user_id, lines: { some: { account_id: id } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit,
      include: transactionInclude,
    }),
    prisma.accountSnapshot.findFirst({ where: { user_id, account_id: id }, orderBy: { date: 'desc' }, select: { date: true, balance: true } }),
  ]);

  // Effet signé de chaque opération sur ce compte = somme de ses lignes sur
  // le compte (un virement débite la source et crédite la destination, chacun
  // dans sa devise).
  const byTx = new Map<number, { signed: number; date: Date; cleared: boolean }>();
  for (const l of lines) {
    const cur = byTx.get(l.transaction_id);
    if (cur) cur.signed += l.amount;
    else byTx.set(l.transaction_id, { signed: l.amount, date: l.transaction.date, cleared: l.transaction.cleared });
  }

  // Rapprochement : le « solde pointé » part de la même ancre que
  // computeAccountBalances (dashboard) — dernier relevé (mouvements strictement
  // après) ou à défaut solde initial (mouvements du jour inclus) — et n'ajoute
  // que les opérations pointées, en devise native du compte.
  const anchor = latestSnapshot ? latestSnapshot.balance : account.initial_balance;
  const since = latestSnapshot ? latestSnapshot.date : account.initial_balance_date;
  const afterAnchor = (date: Date) => (latestSnapshot ? date > since : date >= since);
  let inflow = 0;
  let outflow = 0;
  let clearedDelta = 0;
  let unclearedCount = 0;
  for (const t of byTx.values()) {
    if (t.signed > 0) inflow += t.signed; else outflow += -t.signed;
    if (t.cleared) { if (afterAnchor(t.date)) clearedDelta += t.signed; }
    else if (t.signed !== 0) unclearedCount += 1;
  }

  res.json({
    inflow: round2(inflow),
    outflow: round2(outflow),
    cleared_balance: round2(anchor + clearedDelta),
    uncleared_count: unclearedCount,
    recent: recent.map(serializeTransaction),
  });
}));

// Prêt lié à un bien : un compte emprunt du même profil (et pas le bien lui-même).
async function linkedLoanOf(user_id: number, linkedId: number, selfId?: number): Promise<number> {
  const loan = await prisma.account.findFirst({ where: { id: linkedId, user_id }, select: { id: true, type: true } });
  if (!loan || loan.id === selfId || loan.type !== 'loan') throw new HttpError(400, 'Le prêt lié doit être un compte « Emprunt » de ce profil.');
  return loan.id;
}

accountsRouter.post('/users/:user_id/accounts', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createAccountSchema.parse(req.body);
  const extra = investmentAccountFields.parse(req.body);
  // Nouveau compte d'investissement : les ordres de bourse débitent/créditent
  // ses espèces par défaut (évite le double comptage espèces + titres).
  const investment = ['pea', 'securities', 'crypto', 'retirement'].includes(body.type);
  const row = await prisma.account.create({
    data: {
      ...body,
      user_id,
      initial_balance_date: new Date(body.initial_balance_date),
      orders_affect_cash: extra.orders_affect_cash ?? investment,
      professional: extra.professional ?? false,
      linked_account_id: extra.linked_account_id ? await linkedLoanOf(user_id, extra.linked_account_id) : null,
      annual_fee_rate: extra.annual_fee_rate ?? null,
      fiscal_start_date: extra.fiscal_start_date ? new Date(extra.fiscal_start_date) : null,
    },
  });
  res.status(201).json(row);
}));

accountsRouter.patch('/users/:user_id/accounts/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateAccountSchema.parse(req.body);
  const extra = investmentAccountFields.parse(req.body);
  const existing = await prisma.account.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const toggled = extra.orders_affect_cash !== undefined && extra.orders_affect_cash !== existing.orders_affect_cash;
  const row = await prismaBase.$transaction(async (tx) => {
    const updated = await tx.account.update({
    where: { id },
    data: {
      ...(extra.orders_affect_cash !== undefined ? { orders_affect_cash: extra.orders_affect_cash } : {}),
      ...(extra.professional !== undefined ? { professional: extra.professional } : {}),
      ...(extra.annual_fee_rate !== undefined ? { annual_fee_rate: extra.annual_fee_rate } : {}),
      ...(extra.linked_account_id !== undefined ? { linked_account_id: extra.linked_account_id ? await linkedLoanOf(user_id, extra.linked_account_id, id) : null } : {}),
      ...(extra.fiscal_start_date !== undefined ? { fiscal_start_date: extra.fiscal_start_date ? new Date(extra.fiscal_start_date) : null } : {}),
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.institution_id !== undefined ? { institution_id: body.institution_id ?? null } : {}),
      ...(body.type != null ? { type: body.type } : {}),
      ...(body.currency != null ? { currency: body.currency } : {}),
      ...(body.initial_balance != null ? { initial_balance: body.initial_balance } : {}),
      ...(body.initial_balance_date != null ? { initial_balance_date: new Date(body.initial_balance_date) } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    },
    });
    // Option basculée : (re)génère ou retire les mouvements d'espèces des ordres.
    if (toggled) await resyncAccountOrders(tx, id);
    return updated;
  });
  res.json(row);
}));

accountsRouter.delete('/users/:user_id/accounts/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const existing = await prisma.account.findFirst({ where: { id, user_id }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  // Un compte qui porte des lignes (corbeille comprise) ne se supprime pas :
  // l'historique et les soldes deviendraient incohérents. On l'archive.
  const lineCount = await prisma.transactionLine.count({ where: { user_id, account_id: id } });
  if (lineCount > 0) {
    res.status(409).json({ error: `Ce compte porte encore ${lineCount} ligne${lineCount > 1 ? 's' : ''} d'opération : archive-le plutôt que de le supprimer.` });
    return;
  }
  await prisma.account.delete({ where: { id } });
  res.json({ deleted: true });
}));
