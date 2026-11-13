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

  // Mouvements = lignes des opérations vivantes (le client ne filtre pas la
  // corbeille sur une relation imbriquée : filtre explicite). Un virement est
  // deux lignes, chacune dans la devise de son compte.
  const [accounts, snapshots, lines] = await Promise.all([
    prisma.account.findMany({ where: { user_id } }),
    prisma.accountSnapshot.findMany({ where: { user_id, date: { lte: target } }, orderBy: [{ date: 'desc' }] }),
    prisma.transactionLine.findMany({
      where: { user_id, account_id: { not: null }, transaction: { deleted_at: null, date: { lte: target } } },
      select: { account_id: true, amount: true, transaction: { select: { date: true } } },
    }),
  ]);

  // Premier rencontré = le plus récent grâce au tri date desc.
  const latest = new Map<number, { date: Date; balance: number }>();
  for (const s of snapshots) if (!latest.has(s.account_id)) latest.set(s.account_id, { date: s.date, balance: s.balance });

  // Indexées une fois par compte (au lieu d'un filter O(lignes) par compte).
  const byAccount = new Map<number, Array<{ date: Date; amount: number }>>();
  for (const l of lines) {
    const move = { date: l.transaction.date, amount: l.amount };
    const list = byAccount.get(l.account_id!);
    if (list) list.push(move); else byAccount.set(l.account_id!, [move]);
  }

  const suggestions = accounts.map((account) => {
    const snap = latest.get(account.id);
    const base = snap ? snap.balance : account.initial_balance;
    const since = snap ? snap.date : account.initial_balance_date;
    const matches = (d: Date) => (snap ? d > since : d >= since);
    const delta = (byAccount.get(account.id) ?? [])
      .reduce((s, m) => (matches(m.date) ? s + m.amount : s), 0);
    return {
      account_id: account.id,
      suggested_balance: round2(base + delta),
      last_snapshot_date: snap ? snap.date.toISOString().slice(0, 10) : null,
      last_snapshot_balance: snap ? snap.balance : null,
      delta: round2(delta),
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

// ---------------------------------------------------------------------------
// Rapprochement : entre deux ancres successives (solde initial = ouverture du
// jour, relevé = fin du jour), la somme des opérations doit égaler l'écart de
// solde. Le relevé faisant foi pour le solde, un écart serait sinon absorbé en
// silence (solde juste, statistiques fausses).
// ---------------------------------------------------------------------------

type Anchor = { date: Date; order: 0 | 2; kind: 'initial' | 'snapshot'; value: number; id: number | null };

snapshotsRouter.get('/users/:user_id/accounts/:account_id/reconciliation', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const account_id = idParam.parse(req.params.account_id);
  const account = await prisma.account.findFirst({ where: { id: account_id, user_id } });
  if (!account) throw new HttpError(404, 'Compte introuvable');
  const [snaps, lines] = await Promise.all([
    prisma.accountSnapshot.findMany({ where: { account_id }, orderBy: { date: 'asc' } }),
    prisma.transactionLine.findMany({
      where: { account_id, transaction: { deleted_at: null } },
      select: { amount: true, transaction: { select: { date: true, kind: true } } },
    }),
  ]);
  // Même règle que le calcul des soldes : un relevé l'emporte sur le solde
  // initial. Le solde initial n'est une ancre que s'il précède tous les relevés
  // (sinon, souvent la date de création du compte avec 0 €, il inventerait des
  // écarts au milieu de la chaîne de relevés).
  const firstSnap = snaps[0];
  const initialIsAnchor = !firstSnap || account.initial_balance_date <= firstSnap.date;
  const anchors: Anchor[] = [
    ...(initialIsAnchor ? [{ date: account.initial_balance_date, order: 0, kind: 'initial', value: account.initial_balance, id: null } as Anchor] : []),
    ...snaps.map((s) => ({ date: s.date, order: 2 as const, kind: 'snapshot' as const, value: s.balance, id: s.id })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order);
  // Position d'un mouvement : (date, 1) — après l'ouverture, avant le relevé du jour.
  const pos = (d: Date, order: number) => d.getTime() * 4 + order;
  const moves = lines.map((l) => ({ p: pos(l.transaction.date, 1), amount: l.amount, adjustment: l.transaction.kind === 'adjustment' }));
  const between = (from: number, to: number) => moves.filter((m) => m.p > from && m.p <= to);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const periods = [];
  for (let i = 0; i + 1 < anchors.length; i += 1) {
    const a = anchors[i]!; const b = anchors[i + 1]!;
    const inside = between(pos(a.date, a.order), pos(b.date, b.order));
    const movements = round2(inside.reduce((s, m) => s + m.amount, 0));
    const expected = round2(b.value - a.value);
    periods.push({
      from: { date: day(a.date), kind: a.kind, value: a.value },
      to: { date: day(b.date), kind: b.kind, value: b.value, snapshot_id: b.id },
      expected,
      movements,
      gap: round2(expected - movements),
      count: inside.length,
      adjustments: round2(inside.filter((m) => m.adjustment).reduce((s, m) => s + m.amount, 0)),
    });
  }
  const last = anchors[anchors.length - 1]!;
  const open = between(pos(last.date, last.order), Number.MAX_SAFE_INTEGER);
  res.json({
    account_id,
    currency: account.currency,
    periods,
    open: { from: { date: day(last.date), kind: last.kind, value: last.value }, movements: round2(open.reduce((s, m) => s + m.amount, 0)), count: open.length },
    unreconciled: periods.filter((p) => Math.abs(p.gap) >= 0.01).length,
    total_gap: round2(periods.reduce((s, p) => s + Math.abs(p.gap), 0)),
  });
}));

// Ajustement explicite : comble un écart sans être ni une dépense ni un revenu.
const adjustmentSchema = z.object({
  date: dateString,
  amount: z.coerce.number().refine((n) => Number.isFinite(n) && Math.abs(n) >= 0.01, 'Montant non nul requis').transform(round2),
  description: z.string().trim().max(200).optional(),
});

snapshotsRouter.post('/users/:user_id/accounts/:account_id/adjustments', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const account_id = idParam.parse(req.params.account_id);
  const body = adjustmentSchema.parse(req.body);
  const account = await prisma.account.findFirst({ where: { id: account_id, user_id }, select: { id: true } });
  if (!account) throw new HttpError(404, 'Compte introuvable');
  const row = await prisma.transaction.create({
    data: {
      user_id,
      kind: 'adjustment',
      date: new Date(body.date),
      description: body.description || 'Ajustement de rapprochement',
      cleared: true,
      lines: { create: [{ user_id, account_id, amount: body.amount }] },
    },
    select: { id: true },
  });
  res.status(201).json(row);
}));
