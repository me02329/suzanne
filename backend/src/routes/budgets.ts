import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createBudgetSchema, currencyQuery, idParam, monthString } from '../lib/validation.js';
import { buildFx } from '../lib/fxHelper.js';
import { round2 } from '../lib/money.js';
import { categoryTypeLookup, LEDGER_TX_SELECT, txFlows } from '../lib/ledger.js';

export const budgetsRouter = Router();

budgetsRouter.get('/users/:user_id/budgets', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = req.query.month ? monthString.parse(req.query.month) : undefined;
  if (month) await ensureRecurringBudgets(user_id, month);
  res.json(await prisma.budget.findMany({ where: { user_id, ...(month ? { month } : {}) }, orderBy: { id: 'asc' } }));
}));

// Statut des budgets d'un mois, report d'enveloppe inclus. Pour les budgets
// `rollover`, on replie les mois antérieurs de la catégorie : limite effective =
// limite + report cumulé (solde signé : un dépassement réduit le mois suivant,
// un sous-emploi l'augmente). Le report s'interrompt sur un mois sans rollover.
budgetsRouter.get('/users/:user_id/budgets/status', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  await ensureRecurringBudgets(user_id, month);

  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  const monthEnd = new Date(Date.UTC(year, monthIndex, 1)); // 1er du mois suivant
  const [budgets, accounts, categories, transactions] = await Promise.all([
    prisma.budget.findMany({ where: { user_id, month: { lte: month } }, orderBy: [{ month: 'asc' }, { id: 'asc' }] }),
    prisma.account.findMany({ where: { user_id }, select: { id: true, currency: true } }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, type: true } }),
    // Seules les opérations standard ont un côté dépense/revenu.
    prisma.transaction.findMany({ where: { user_id, kind: 'standard', date: { lt: monthEnd } }, select: LEDGER_TX_SELECT }),
  ]);
  const { rates: fx } = await buildFx(accounts, reportCurrency);
  const currencyByAccount = new Map(accounts.map((a) => [a.id, a.currency]));
  const categoryType = categoryTypeLookup(categories);
  // Devise d'un flux = devise du compte de sa ligne (EUR sans compte).
  const rateOf = (accountId: number | null) => fx.get(currencyByAccount.get(accountId ?? -1) ?? 'EUR') ?? 1;

  // Dépensé net par (mois, catégorie), via txFlows comme le dashboard : une
  // ligne de remboursement est une dépense négative sur sa catégorie.
  const spentByMonth = new Map<string, Map<number | null, number>>();
  for (const t of transactions) {
    const k = t.date.toISOString().slice(0, 7);
    let byCat = spentByMonth.get(k);
    if (!byCat) { byCat = new Map(); spentByMonth.set(k, byCat); }
    for (const flow of txFlows(t, categoryType)) {
      if (flow.side !== 'expense') continue;
      byCat.set(flow.category_id, (byCat.get(flow.category_id) ?? 0) + flow.value * rateOf(flow.account_id));
    }
  }
  const spentFor = (m: string) => spentByMonth.get(m) ?? new Map<number | null, number>();

  // Budgets groupés par catégorie, chaîne de mois ascendante pour le repli.
  const byCategory = new Map<number, typeof budgets>();
  for (const b of budgets) {
    const list = byCategory.get(b.category_id); if (list) list.push(b); else byCategory.set(b.category_id, [b]);
  }

  const status = [];
  for (const [category_id, chain] of byCategory) {
    let carry = 0;
    for (const b of chain) {
      const spent = round2(spentFor(b.month).get(category_id) ?? 0);
      if (b.month === month) {
        const carried = b.rollover ? round2(carry) : 0;
        const effective = round2(b.amount_limit + carried);
        status.push({ ...b, spent, carried_over: carried, effective_limit: effective, remaining: round2(effective - spent) });
        break;
      }
      // Mois antérieur : on accumule le report si rollover, sinon on coupe.
      carry = b.rollover ? (b.amount_limit + carry) - spent : 0;
    }
  }

  res.json(status);
}));

budgetsRouter.post('/users/:user_id/budgets', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createBudgetSchema.parse(req.body);
  // `recurring` omis = on ne touche pas au flag existant : re-saisir une
  // limite ne doit pas désactiver silencieusement la reconduction.
  const row = await prisma.budget.upsert({
    where: { user_id_category_id_month: { user_id, category_id: body.category_id, month: body.month } },
    create: { category_id: body.category_id, month: body.month, amount_limit: body.amount_limit, recurring: body.recurring ?? false, rollover: body.rollover ?? false, user_id },
    update: {
      amount_limit: body.amount_limit,
      ...(body.recurring !== undefined ? { recurring: body.recurring } : {}),
      ...(body.rollover !== undefined ? { rollover: body.rollover } : {}),
    },
  });
  res.json(row);
}));

budgetsRouter.delete('/users/:user_id/budgets/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const existing = await prisma.budget.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  // Supprimer un budget reconduit signifie « arrêter cette reconduction » :
  // sans ça, ensureRecurringBudgets le recréerait au prochain affichage du
  // mois depuis un mois antérieur. On coupe donc le flag sur toute la chaîne
  // de la catégorie (l'historique des montants reste en place).
  await prisma.$transaction([
    prisma.budget.delete({ where: { id } }),
    ...(existing.recurring
      ? [prisma.budget.updateMany({
          where: { user_id, category_id: existing.category_id, recurring: true },
          data: { recurring: false },
        })]
      : []),
  ]);
  res.json({ deleted: true });
}));

// Reconduction : pour chaque catégorie, on regarde le budget le plus récent
// strictement antérieur au mois demandé — c'est lui qui fait foi. S'il est
// marqué `recurring`, on le copie sur le mois ; s'il ne l'est pas (reconduction
// arrêtée), on ne crée rien, même si un mois plus ancien était reconduit.
async function ensureRecurringBudgets(user_id: number, month: string): Promise<void> {
  const [existingForMonth, previousBudgets] = await Promise.all([
    prisma.budget.findMany({ where: { user_id, month }, select: { category_id: true } }),
    prisma.budget.findMany({
      where: { user_id, month: { lt: month } },
      orderBy: [{ month: 'desc' }, { id: 'desc' }],
    }),
  ]);
  const existingCategoryIds = new Set(existingForMonth.map((budget) => budget.category_id));
  const latestByCategory = new Map<number, typeof previousBudgets[number]>();
  for (const budget of previousBudgets) {
    if (!latestByCategory.has(budget.category_id)) latestByCategory.set(budget.category_id, budget);
  }
  const toCreate = Array.from(latestByCategory.values())
    .filter((budget) => budget.recurring && !existingCategoryIds.has(budget.category_id))
    .map((budget) => ({
      user_id,
      category_id: budget.category_id,
      month,
      amount_limit: budget.amount_limit,
      recurring: true,
      // Le report d'enveloppe suit la reconduction.
      rollover: budget.rollover,
    }));
  // skipDuplicates : deux GET concurrents (deux onglets) ne doivent pas faire
  // un 409 sur la contrainte (user, category, month).
  if (toCreate.length > 0) await prisma.budget.createMany({ data: toCreate, skipDuplicates: true });
}
