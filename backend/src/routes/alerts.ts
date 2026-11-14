import { Router } from 'express';
import { budgetAlerts } from './budgets.js';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createAlertSchema, currencyQuery, idParam, updateAlertSchema, monthString } from '../lib/validation.js';
import { securitiesByAccountNow } from '../lib/holdingsValuation.js';
import { computeAccountBalances } from './dashboard.js';
import { evaluateAlerts, type AlertConfig } from '../lib/alerts.js';
import { LEDGER_TX_SELECT, legacyView, LINE_SELECT, LINES_ORDERED } from '../lib/ledger.js';

export const alertsRouter = Router();

alertsRouter.get('/users/:user_id/alerts', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.alert.findMany({ where: { user_id }, orderBy: { id: 'desc' } }));
}));

// Évaluation à la volée : on calcule l'état courant (soldes en devise de
// reporting, transactions du mois, derniers relevés, objectifs) et on renvoie
// les alertes déclenchées avec un message prêt à afficher.
alertsRouter.get('/users/:user_id/alerts/triggered', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  const month = monthString.parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

  const [alerts, budgetTriggered] = await Promise.all([
    prisma.alert.findMany({ where: { user_id, active: true } }),
    budgetAlerts(user_id, month, reportCurrency).catch(() => []),
  ]);
  if (alerts.length === 0) {
    res.json(budgetTriggered);
    return;
  }

  const [transactions, accounts, snapshots, holdings, goals] = await Promise.all([
    prisma.transaction.findMany({
      where: { user_id },
      select: { ...LEDGER_TX_SELECT, description: true, lines: { select: LINE_SELECT, ...LINES_ORDERED } },
    }),
    prisma.account.findMany({ where: { user_id }, select: { id: true, name: true, type: true, currency: true, initial_balance: true, initial_balance_date: true, professional: true } }),
    prisma.accountSnapshot.findMany({ where: { user_id }, select: { account_id: true, date: true, balance: true } }),
    prisma.holding.findMany({ where: { user_id }, select: { id: true, account_id: true, symbol: true, name: true, asset_class: true, currency: true, orders: { select: { id: true, side: true, date: true, quantity: true, unit_price: true, fee: true } } } }),
    prisma.savingsGoal.findMany({ where: { user_id }, select: { id: true, name: true, current_amount: true, target_amount: true, deadline: true } }),
  ]);

  const securities = await securitiesByAccountNow(holdings, accounts);
  // Seuils de solde comparés dans la devise du compte (taux neutre : pas de
  // conversion) et en valeur absolue pour un passif — `balance` de
  // computeAccountBalances est déjà |solde| pour un passif. Cf. lib/alerts.ts.
  const balances = computeAccountBalances(accounts, transactions, snapshots, new Map(), securities);
  const balanceByAccount = new Map(balances.map((b) => [b.account_id, b.balance]));
  const latestSnapshotByAccount = new Map<number, Date>();
  for (const s of snapshots) {
    const cur = latestSnapshotByAccount.get(s.account_id);
    if (!cur || s.date > cur) latestSnapshotByAccount.set(s.account_id, s.date);
  }
  const proIds = new Set(accounts.filter((a) => a.professional).map((a) => a.id));
  const monthTransactions = transactions
    .filter((t) => t.date >= start && t.date < end)
    .map((t) => {
      const view = legacyView(t);
      // trade / adjustment : le genre sert de type (exclus des flux).
      const type = t.kind === 'standard' || t.kind === 'transfer' ? view.type : t.kind;
      // Compte pro : pas un flux perso (seule une alerte ciblée sur ce compte le voit).
      const professional = view.account_id != null && proIds.has(view.account_id);
      return { amount: view.amount, type, account_id: view.account_id, description: t.description ?? '', professional };
    });

  const triggered = evaluateAlerts(alerts as AlertConfig[], {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
    balanceByAccount,
    monthTransactions,
    goals: goals.map((g) => ({ ...g, deadline: g.deadline ? g.deadline.toISOString().slice(0, 10) : null })),
    latestSnapshotByAccount,
    today: new Date(),
    currency: reportCurrency,
  });
  res.json([...triggered, ...budgetTriggered]);
}));

alertsRouter.post('/users/:user_id/alerts', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createAlertSchema.parse(req.body);
  if (body.account_id != null) {
    const account = await prisma.account.findFirst({ where: { id: body.account_id, user_id }, select: { id: true } });
    if (!account) { res.status(400).json({ error: 'Compte introuvable pour cet utilisateur' }); return; }
  }
  if (body.goal_id != null) {
    const goal = await prisma.savingsGoal.findFirst({ where: { id: body.goal_id, user_id }, select: { id: true } });
    if (!goal) { res.status(400).json({ error: 'Objectif introuvable pour cet utilisateur' }); return; }
  }
  const row = await prisma.alert.create({
    data: {
      user_id,
      type: body.type,
      account_id: body.account_id ?? null,
      goal_id: body.goal_id ?? null,
      operator: body.operator ?? null,
      threshold: body.threshold ?? null,
      active: body.active,
    },
  });
  res.status(201).json(row);
}));

alertsRouter.patch('/users/:user_id/alerts/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateAlertSchema.parse(req.body);
  const existing = await prisma.alert.findFirst({ where: { id, user_id }, select: { id: true } });
  if (!existing) { res.status(404).json({ error: 'Alerte introuvable' }); return; }
  if (body.account_id != null) {
    const account = await prisma.account.findFirst({ where: { id: body.account_id, user_id }, select: { id: true } });
    if (!account) { res.status(400).json({ error: 'Compte introuvable pour cet utilisateur' }); return; }
  }
  if (body.goal_id != null) {
    const goal = await prisma.savingsGoal.findFirst({ where: { id: body.goal_id, user_id }, select: { id: true } });
    if (!goal) { res.status(400).json({ error: 'Objectif introuvable pour cet utilisateur' }); return; }
  }
  const row = await prisma.alert.update({
    where: { id },
    data: {
      ...(body.type != null ? { type: body.type } : {}),
      ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
      ...(body.goal_id !== undefined ? { goal_id: body.goal_id ?? null } : {}),
      ...(body.operator !== undefined ? { operator: body.operator ?? null } : {}),
      ...(body.threshold !== undefined ? { threshold: body.threshold ?? null } : {}),
      ...(body.active != null ? { active: body.active } : {}),
    },
  });
  res.json(row);
}));

alertsRouter.delete('/users/:user_id/alerts/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.alert.deleteMany({ where: { id, user_id } });
  if (result.count === 0) { res.status(404).json({ error: 'Alerte introuvable' }); return; }
  res.json({ deleted: true });
}));
