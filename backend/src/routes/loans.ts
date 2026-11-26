import { Router } from 'express';
import { z } from 'zod';
import { prisma, prismaBase } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { assertCategoryOwned } from '../lib/transactionHelpers.js';
import { idParam } from '../lib/validation.js';
import { round2 } from '../lib/money.js';

// Prêts : un compte par prêt.
// - « loan » (Emprunt) : on me prête. Le compte descend sous 0 quand je reçois
//   l'argent (ou qu'on paie un achat pour moi) et remonte vers 0 à chaque
//   remboursement : reste dû = −solde.
// - « receivable » (Prêt accordé) : je prête. Le compte monte quand je verse
//   l'argent et redescend quand on me rembourse : reste dû = solde.
// Le résumé se calcule à partir des lignes du compte (solde initial compris) ;
// les relevés de solde ne s'appliquent pas à ces comptes.
export const loansRouter = Router();

type Movement = { transaction_id: number; date: string; description: string | null; kind: string; amount: number; category_id: number | null };

// ---- Rattacher une opération existante à un prêt ---------------------------
//
// Cas typique : la banque (ou un import) a apporté « PRLV ORGANISME CREDIT
// −312,40 » comme une dépense. Rattachée au prêt, elle devient le virement de
// remboursement : le reste dû baisse, ce n'est plus une dépense. Une partie
// peut être déclarée en intérêts / assurance : elle reste une vraie dépense,
// dans une opération à part (même date, même compte), si bien que le solde du
// compte ne bouge pas. Pour un prêt accordé, c'est l'inverse : une rentrée
// d'argent devient le remboursement reçu.

const loanAccount = async (user_id: number, account_id: number) => {
  const account = await prisma.account.findFirst({ where: { id: account_id, user_id, type: { in: ['loan', 'receivable'] } }, select: { id: true, type: true, name: true } });
  if (!account) throw new HttpError(404, 'Prêt introuvable');
  return account;
};

const CANDIDATE_DAYS = 400;

/** Opérations qui pourraient être un remboursement de ce prêt (les plus récentes d'abord). */
loansRouter.get('/users/:user_id/loans/:account_id/candidates', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const loan = await loanAccount(user_id, idParam.parse(req.params.account_id));
  const since = new Date(Date.now() - CANDIDATE_DAYS * 86400000);
  const rows = await prisma.transaction.findMany({
    where: { user_id, kind: 'standard', date: { gte: since }, lines: { every: { account_id: { not: null } } } },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: 400,
    select: { id: true, date: true, description: true, lines: { select: { account_id: true, amount: true, category_id: true, account: { select: { type: true } } } } },
  });
  const outflow = loan.type === 'loan'; // emprunt : je rembourse = argent qui sort
  res.json(rows
    .filter((t) => t.lines.length === 1
      && !['loan', 'receivable'].includes(t.lines[0]!.account?.type ?? '')
      && (outflow ? t.lines[0]!.amount < 0 : t.lines[0]!.amount > 0))
    .slice(0, 150)
    .map((t) => ({
      transaction_id: t.id,
      date: t.date.toISOString().slice(0, 10),
      description: t.description,
      account_id: t.lines[0]!.account_id,
      amount: round2(Math.abs(t.lines[0]!.amount)),
      category_id: t.lines[0]!.category_id,
    })));
}));

const linkBody = z.object({
  transaction_id: z.coerce.number().int().positive(),
  // Part intérêts + assurance (emprunt seulement) : reste une dépense.
  interest_amount: z.coerce.number().min(0).optional(),
  interest_category_id: z.coerce.number().int().positive().nullish(),
});

loansRouter.post('/users/:user_id/loans/:account_id/link', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const loan = await loanAccount(user_id, idParam.parse(req.params.account_id));
  const body = linkBody.parse(req.body);
  const tx = await prisma.transaction.findFirst({
    where: { id: body.transaction_id, user_id },
    select: { id: true, kind: true, date: true, description: true, lines: { select: { id: true, account_id: true, amount: true, account: { select: { type: true } } } } },
  });
  if (!tx) throw new HttpError(404, 'Opération introuvable');
  const line = tx.lines[0];
  if (tx.kind !== 'standard' || tx.lines.length !== 1 || !line?.account_id) {
    throw new HttpError(400, 'Seule une dépense ou une rentrée simple, sur un de tes comptes, peut être rattachée à un prêt');
  }
  if (['loan', 'receivable'].includes(line.account?.type ?? '')) throw new HttpError(400, 'L’opération est déjà sur un compte de prêt');
  const outflow = loan.type === 'loan';
  if (outflow ? line.amount >= 0 : line.amount <= 0) {
    throw new HttpError(400, outflow ? 'Un remboursement d’emprunt est une sortie d’argent' : 'Un remboursement reçu est une entrée d’argent');
  }
  const total = round2(Math.abs(line.amount));
  const interest = outflow ? round2(body.interest_amount ?? 0) : 0;
  if (interest >= total) throw new HttpError(400, 'Les intérêts doivent être inférieurs à la mensualité');
  if (interest > 0 && body.interest_category_id) await assertCategoryOwned(user_id, body.interest_category_id);
  const principal = round2(total - interest);

  await prismaBase.$transaction(async (db) => {
    // L'opération devient le virement (capital) ; son empreinte bancaire, sa
    // date et son libellé restent : une nouvelle synchro la reconnaît.
    await db.transaction.update({ where: { id: tx.id }, data: { kind: 'transfer' } });
    await db.transactionLine.update({ where: { id: line.id }, data: { category_id: null, refund: false, refund_of_id: null, amount: outflow ? -principal : principal, position: 0 } });
    await db.transactionLine.create({ data: { user_id, transaction_id: tx.id, account_id: loan.id, amount: outflow ? principal : -principal, position: 1 } });
    if (interest > 0) {
      await db.transaction.create({
        data: {
          user_id,
          kind: 'standard',
          date: tx.date,
          description: `${tx.description ?? loan.name} — intérêts et assurance`,
          lines: { create: [{ user_id, account_id: line.account_id, amount: -interest, category_id: body.interest_category_id ?? null }] },
        },
      });
    }
  });
  res.json({ transaction_id: tx.id, principal, interest });
}));

loansRouter.get('/users/:user_id/loans', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const accounts = await prisma.account.findMany({
    where: { user_id, type: { in: ['loan', 'receivable'] } },
    select: { id: true, name: true, type: true, currency: true, archived: true, institution_id: true, initial_balance: true, initial_balance_date: true },
    orderBy: { name: 'asc' },
  });
  const lines = accounts.length === 0 ? [] : await prisma.transactionLine.findMany({
    where: { user_id, account_id: { in: accounts.map((a) => a.id) }, transaction: { deleted_at: null } },
    select: { account_id: true, amount: true, category_id: true, transaction: { select: { id: true, date: true, description: true, kind: true } } },
  });

  res.json(accounts.map((account) => {
    // Sens « dette » : + = je dois (emprunt) / on me doit (prêt accordé).
    const sign = account.type === 'loan' ? -1 : 1;
    const movements: Movement[] = lines
      .filter((l) => l.account_id === account.id)
      .map((l) => ({
        transaction_id: l.transaction.id,
        date: l.transaction.date.toISOString().slice(0, 10),
        description: l.transaction.description,
        kind: l.transaction.kind,
        amount: round2(l.amount),
        category_id: l.category_id,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.transaction_id - b.transaction_id);

    let outstanding = round2(sign * account.initial_balance);
    let principal = Math.max(0, outstanding);
    let repaid = 0;
    let lastRepayment: string | null = null;
    const series: Array<{ date: string; outstanding: number }> = [];
    const start = account.initial_balance !== 0 ? account.initial_balance_date.toISOString().slice(0, 10) : movements[0]?.date ?? null;
    if (account.initial_balance !== 0 && start) series.push({ date: start, outstanding });
    for (const m of movements) {
      const delta = round2(sign * m.amount); // + : la dette augmente ; − : remboursement
      if (delta > 0) principal = round2(principal + delta);
      else { repaid = round2(repaid - delta); lastRepayment = m.date; }
      outstanding = round2(outstanding + delta);
      series.push({ date: m.date, outstanding });
    }
    const settled = Math.abs(outstanding) < 0.005 && movements.length > 0;
    return {
      account_id: account.id,
      name: account.name,
      direction: account.type === 'loan' ? 'borrowed' : 'lent',
      currency: account.currency,
      archived: account.archived,
      institution_id: account.institution_id,
      principal,
      repaid,
      outstanding,
      status: settled || (account.archived && outstanding <= 0.005) ? 'settled' : 'active',
      start_date: start,
      last_repayment_date: lastRepayment,
      settled_date: settled ? movements[movements.length - 1]!.date : null,
      series,
      movements: movements.reverse(),
    };
  }));
}));
