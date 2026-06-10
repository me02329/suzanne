import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createAccountSchema, idParam, updateAccountSchema } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { serializeTransaction, transactionInclude } from './transactions.js';

export const accountsRouter = Router();

accountsRouter.get('/users/:user_id/accounts', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.account.findMany({ where: { user_id }, orderBy: { name: 'asc' } }));
}));

// Activity for one account: all-time inflow/outflow totals + the most recent
// movements. Replaces the account detail page fetching every user transaction
// and filtering client-side — here the query is scoped to the account (indexed
// on account_id / to_account_id) and only `limit` rows cross the wire.
accountsRouter.get('/users/:user_id/accounts/:id/activity', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const limit = z.coerce.number().int().min(1).max(200).default(40).parse(req.query.limit ?? 40);

  const account = await prisma.account.findFirst({ where: { id, user_id }, select: { id: true } });
  if (!account) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Les totaux lisent toutes les lignes du compte mais en projection minimale ;
  // seules les `limit` lignes renvoyées embarquent tags et liens.
  const where = { user_id, OR: [{ account_id: id }, { to_account_id: id }] };
  const [totalsRows, recent] = await Promise.all([
    prisma.transaction.findMany({
      where,
      select: { type: true, amount: true, to_amount: true, account_id: true, to_account_id: true },
    }),
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit,
      include: transactionInclude,
    }),
  ]);

  // Signed effect on this account, mirroring frontend lib/account.ts
  // accountSignedAmount: a transfer debits its source and credits its
  // destination (to_amount when the currencies differ).
  let inflow = 0;
  let outflow = 0;
  for (const t of totalsRows) {
    let signed = 0;
    if (t.type === 'transfer') {
      if (t.account_id === id) signed = -t.amount;
      else if (t.to_account_id === id) signed = t.to_amount ?? t.amount;
    } else if (t.account_id === id) {
      signed = t.type === 'income' ? t.amount : -t.amount;
    }
    if (signed > 0) inflow += signed; else outflow += -signed;
  }

  res.json({
    inflow: round2(inflow),
    outflow: round2(outflow),
    recent: recent.map(serializeTransaction),
  });
}));

accountsRouter.post('/users/:user_id/accounts', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createAccountSchema.parse(req.body);
  const row = await prisma.account.create({ data: { ...body, user_id, initial_balance_date: new Date(body.initial_balance_date) } });
  res.status(201).json(row);
}));

accountsRouter.patch('/users/:user_id/accounts/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateAccountSchema.parse(req.body);
  const existing = await prisma.account.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const row = await prisma.account.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      ...(body.institution_id !== undefined ? { institution_id: body.institution_id ?? null } : {}),
      ...(body.type != null ? { type: body.type } : {}),
      ...(body.currency != null ? { currency: body.currency } : {}),
      ...(body.initial_balance != null ? { initial_balance: body.initial_balance } : {}),
      ...(body.initial_balance_date != null ? { initial_balance_date: new Date(body.initial_balance_date) } : {}),
    },
  });
  res.json(row);
}));

accountsRouter.delete('/users/:user_id/accounts/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.account.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));
