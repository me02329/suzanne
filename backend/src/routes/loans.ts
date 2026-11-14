import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
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
