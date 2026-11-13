import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { idParam } from '../lib/validation.js';
import { detectAnomalies, type AnomalyTx } from '../lib/anomalies.js';
import { LEDGER_TX_SELECT, legacyView, LINES_ORDERED, LINE_SELECT } from '../lib/ledger.js';

export const anomaliesRouter = Router();

// Analyse de qualité des données : orphelins (sans compte), sans catégorie, et
// doublons probables. Lecture seule — l'utilisateur corrige depuis Transactions.
anomaliesRouter.get('/users/:user_id/anomalies', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const transactions = await prisma.transaction.findMany({
    where: { user_id },
    select: { ...LEDGER_TX_SELECT, description: true, lines: { select: LINE_SELECT, ...LINES_ORDERED } },
  });
  // Vue « une ligne par opération » dérivée des lignes : type historique
  // (ou le genre pour trade / adjustment, exclus des contrôles), compte
  // manquant si une ligne n'en a pas, catégorie manquante si une ligne non
  // remboursement n'en a pas (une ventilation entièrement catégorisée est OK).
  const rows: AnomalyTx[] = transactions.map((t) => {
    const view = legacyView(t);
    const missingAccount = t.lines.some((l) => l.account_id == null);
    const missingCategory = t.lines.length === 0 || t.lines.some((l) => l.category_id == null && !l.refund);
    const firstCategory = t.lines.find((l) => l.category_id != null)?.category_id ?? null;
    return {
      id: t.id,
      date: t.date,
      amount: view.amount,
      type: t.kind === 'standard' || t.kind === 'transfer' ? view.type : t.kind,
      description: t.description,
      account_id: missingAccount ? null : view.account_id,
      category_id: missingCategory ? null : view.category_id ?? firstCategory,
    };
  });
  res.json(detectAnomalies(rows));
}));
