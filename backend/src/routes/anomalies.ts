import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { idParam } from '../lib/validation.js';
import { detectAnomalies } from '../lib/anomalies.js';

export const anomaliesRouter = Router();

// Analyse de qualité des données : orphelins (sans compte), sans catégorie, et
// doublons probables. Lecture seule — l'utilisateur corrige depuis Transactions.
anomaliesRouter.get('/users/:user_id/anomalies', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const transactions = await prisma.transaction.findMany({
    where: { user_id },
    select: { id: true, date: true, amount: true, type: true, description: true, account_id: true, category_id: true },
  });
  res.json(detectAnomalies(transactions));
}));
