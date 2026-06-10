import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { batchAccountSnapshotsSchema, createAccountSnapshotSchema, dateString, idParam } from '../lib/validation.js';
import { round2 } from '../lib/money.js';

// L'upsert des snapshots est keyé sur (account_id, date) : sans ce contrôle,
// un user pourrait écraser le snapshot d'un compte d'un autre utilisateur.
async function assertAccountsOwned(userId: number, accountIds: number[]): Promise<void> {
  const unique = Array.from(new Set(accountIds));
  const owned = await prisma.account.findMany({ where: { id: { in: unique }, user_id: userId }, select: { id: true } });
  if (owned.length !== unique.length) {
    throw new HttpError(400, 'Compte introuvable pour cet utilisateur');
  }
}

export const snapshotsRouter = Router();

snapshotsRouter.get('/users/:user_id/account-snapshots', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.accountSnapshot.findMany({ where: { user_id }, orderBy: [{ date: 'desc' }, { id: 'desc' }] }));
}));

// Pré-remplissage du snapshot batch (cf. issue #10) : pour chaque compte,
// suggère le solde à la date cible = dernier snapshot connu (≤ date) + delta des
// transactions postérieures à ce snapshot. À défaut de snapshot, on part du solde
// initial du compte. La valeur renvoyée est brute (ni FX, ni abs sur les passifs),
// telle que l'utilisateur la saisirait.
snapshotsRouter.get('/users/:user_id/account-snapshots/suggestions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const { date } = z.object({ date: dateString }).parse(req.query);
  const target = new Date(date);

  const [accounts, snapshots, transactions] = await Promise.all([
    prisma.account.findMany({ where: { user_id } }),
    prisma.accountSnapshot.findMany({ where: { user_id, date: { lte: target } }, orderBy: [{ date: 'desc' }] }),
    prisma.transaction.findMany({
      where: { user_id, date: { lte: target } },
      select: { type: true, amount: true, to_amount: true, date: true, account_id: true, to_account_id: true },
    }),
  ]);

  // Premier rencontré = le plus récent grâce au tri date desc.
  const latest = new Map<number, { date: Date; balance: number }>();
  for (const s of snapshots) if (!latest.has(s.account_id)) latest.set(s.account_id, { date: s.date, balance: s.balance });

  // Indexées une fois par compte (au lieu d'un filter O(transactions) par compte).
  type SuggestionTx = (typeof transactions)[number];
  const bySource = new Map<number, SuggestionTx[]>();
  const byDest = new Map<number, SuggestionTx[]>();
  for (const t of transactions) {
    if (t.account_id != null) {
      const list = bySource.get(t.account_id);
      if (list) list.push(t); else bySource.set(t.account_id, [t]);
    }
    if (t.type === 'transfer' && t.to_account_id != null) {
      const list = byDest.get(t.to_account_id);
      if (list) list.push(t); else byDest.set(t.to_account_id, [t]);
    }
  }

  const suggestions = accounts.map((account) => {
    const snap = latest.get(account.id);
    const base = snap ? snap.balance : account.initial_balance;
    const since = snap ? snap.date : account.initial_balance_date;
    const matches = (d: Date) => (snap ? d > since : d >= since);
    const outgoing = (bySource.get(account.id) ?? [])
      .reduce((s, t) => (matches(t.date) ? s + (t.type === 'income' ? t.amount : -t.amount) : s), 0);
    const incoming = (byDest.get(account.id) ?? [])
      .reduce((s, t) => (matches(t.date) ? s + (t.to_amount ?? t.amount) : s), 0);
    return {
      account_id: account.id,
      suggested_balance: round2(base + outgoing + incoming),
      last_snapshot_date: snap ? snap.date.toISOString().slice(0, 10) : null,
      last_snapshot_balance: snap ? snap.balance : null,
      delta: round2(outgoing + incoming),
    };
  });
  res.json(suggestions);
}));

snapshotsRouter.post('/users/:user_id/account-snapshots', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createAccountSnapshotSchema.parse(req.body);
  await assertAccountsOwned(user_id, [body.account_id]);
  const date = new Date(body.date);
  const row = await prisma.accountSnapshot.upsert({
    where: { account_id_date: { account_id: body.account_id, date } },
    create: { user_id, account_id: body.account_id, date, balance: body.balance },
    update: { balance: body.balance },
  });
  res.json(row);
}));

// Batch upsert — saves end-of-month snapshots for several accounts in a
// single atomic transaction. Re-using the same (account_id, date) pair as
// the unique key means submitting twice just updates the balance.
snapshotsRouter.post('/users/:user_id/account-snapshots/batch', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = batchAccountSnapshotsSchema.parse(req.body);
  const date = new Date(body.date);
  // Snapshot which account_ids already have a row for that exact date,
  // *before* the upsert, so we can report created vs updated counts.
  const accountIds = body.balances.map((b) => b.account_id);
  await assertAccountsOwned(user_id, accountIds);
  const existing = await prisma.accountSnapshot.findMany({
    where: { user_id, date, account_id: { in: accountIds } },
    select: { account_id: true },
  });
  const existingAccountIds = new Set(existing.map((e) => e.account_id));

  const rows = await prisma.$transaction(
    body.balances.map((entry) =>
      prisma.accountSnapshot.upsert({
        where: { account_id_date: { account_id: entry.account_id, date } },
        create: { user_id, account_id: entry.account_id, date, balance: entry.balance },
        update: { balance: entry.balance },
      }),
    ),
  );
  const updated = body.balances.filter((b) => existingAccountIds.has(b.account_id)).length;
  const created = rows.length - updated;
  res.status(201).json({ saved: rows.length, created, updated });
}));

snapshotsRouter.delete('/users/:user_id/account-snapshots/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.accountSnapshot.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));
