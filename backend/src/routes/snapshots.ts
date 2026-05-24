import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createAccountSnapshotSchema, idParam } from '../lib/validation.js';

export const snapshotsRouter = Router();

snapshotsRouter.get('/users/:user_id/account-snapshots', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.accountSnapshot.findMany({ where: { user_id }, orderBy: [{ date: 'desc' }, { id: 'desc' }] }));
}));

snapshotsRouter.post('/users/:user_id/account-snapshots', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createAccountSnapshotSchema.parse(req.body);
  const date = new Date(body.date);
  const row = await prisma.accountSnapshot.upsert({
    where: { account_id_date: { account_id: body.account_id, date } },
    create: { user_id, account_id: body.account_id, date, balance: body.balance },
    update: { balance: body.balance },
  });
  res.json(row);
}));

snapshotsRouter.delete('/account-snapshots/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  await prisma.accountSnapshot.delete({ where: { id } });
  res.json({ deleted: true });
}));
