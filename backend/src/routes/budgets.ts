import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { computePace, previousMonths, sinkingFundCycle, suggestLimit } from '../lib/budgetEngine.js';
import { createBudgetSchema, currencyQuery, idParam, monthString } from '../lib/validation.js';
import { buildFx } from '../lib/fxHelper.js';
import { round2 } from '../lib/money.js';
import { categoryTypeLookup, LEDGER_TX_SELECT, professionalAccountFilter, txFlows } from '../lib/ledger.js';

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
  res.json((await computeBudgetStatus(user_id, month, reportCurrency)).status);
}));

// Dépensé net par mois et par catégorie (devise de reporting), via txFlows.
async function loadSpend(user_id: number, reportCurrency: string, untilMonth: string, fromMonth?: string) {
  const [year, monthIndex] = untilMonth.split('-').map(Number) as [number, number];
  const monthEnd = new Date(Date.UTC(year, monthIndex, 1));
  const [accounts, categories, transactions] = await Promise.all([
    prisma.account.findMany({ where: { user_id }, select: { id: true, currency: true } }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, type: true, name: true, color: true } }),
    prisma.transaction.findMany({
      where: {
        user_id,
        kind: 'standard',
        date: { lt: monthEnd, ...(fromMonth ? { gte: new Date(fromMonth + '-01T00:00:00.000Z') } : {}) },
        // Tags « hors budgets » (ex. frais pro) : leurs opérations ne comptent pas.
        tags: { none: { tag: { exclude_from_budgets: true } } },
      },
      select: LEDGER_TX_SELECT,
    }),
  ]);
  const { rates: fx } = await buildFx(accounts, reportCurrency);
  const currencyByAccount = new Map(accounts.map((a) => [a.id, a.currency]));
  const categoryType = categoryTypeLookup(categories);
  const excluded = await professionalAccountFilter(user_id);
  const rateOf = (accountId: number | null) => fx.get(currencyByAccount.get(accountId ?? -1) ?? 'EUR') ?? 1;
  const byMonth = new Map<string, Map<number | null, number>>();
  for (const t of transactions) {
    const k = t.date.toISOString().slice(0, 7);
    let byCat = byMonth.get(k);
    if (!byCat) { byCat = new Map(); byMonth.set(k, byCat); }
    for (const flow of txFlows(t, categoryType, excluded)) {
      if (flow.side !== 'expense') continue;
      byCat.set(flow.category_id, (byCat.get(flow.category_id) ?? 0) + flow.value * rateOf(flow.account_id));
    }
  }
  const spentFor = (m: string) => byMonth.get(m) ?? new Map<number | null, number>();
  const totalFor = (m: string) => Array.from(spentFor(m).values()).reduce((acc, v) => acc + v, 0);
  return { spentFor, totalFor, categories };
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

async function computeBudgetStatus(user_id: number, month: string, reportCurrency: string) {
  await ensureRecurringBudgets(user_id, month);

  const [budgets, spend] = await Promise.all([
    prisma.budget.findMany({ where: { user_id, month: { lte: month } }, orderBy: [{ month: 'asc' }, { id: 'asc' }] }),
    loadSpend(user_id, reportCurrency, month),
  ]);
  const { spentFor } = spend;
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
        status.push({ ...b, spent, carried_over: carried, effective_limit: effective, remaining: round2(effective - spent), pace: computePace(month, effective, spent, todayUtc()) });
        break;
      }
      // Mois antérieur : on accumule le report si rollover, sinon on coupe.
      carry = b.rollover ? (b.amount_limit + carry) - spent : 0;
    }
  }

  return { status, spend };
}

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

// ---------------------------------------------------------------------------
// Vue d'ensemble : budget global (reste à vivre), enveloppes, provisions.
// ---------------------------------------------------------------------------

budgetsRouter.get('/users/:user_id/budgets/overview', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  await ensureRecurringGlobalBudget(user_id, month);
  const [{ status, spend }, global, funds] = await Promise.all([
    computeBudgetStatus(user_id, month, reportCurrency),
    prisma.globalBudget.findUnique({ where: { user_id_month: { user_id, month } } }),
    prisma.sinkingFund.findMany({ where: { user_id }, orderBy: { name: 'asc' } }),
  ]);
  const total = round2(spend.totalFor(month));
  const budgeted = round2(status.reduce((acc, b) => acc + b.spent, 0));
  const today = todayUtc();
  const fundStatus = [];
  for (const fund of funds) {
    const cycle = sinkingFundCycle(fund, month);
    // Dépenses de la catégorie liée sur le cycle (jusqu'au mois affiché).
    let spent = 0;
    if (fund.category_id != null && cycle.months_elapsed > 0) {
      for (let m = cycle.cycle_start; m <= month; m = nextMonth(m)) {
        spent += spend.spentFor(m).get(fund.category_id) ?? 0;
      }
    }
    fundStatus.push({ ...fund, ...cycle, spent: round2(spent), available: round2(cycle.accrued - spent) });
  }
  res.json({
    month,
    currency: reportCurrency,
    total_spent: total,
    budgeted_spent: budgeted,
    unbudgeted_spent: round2(total - budgeted),
    global: global
      ? { ...global, spent: total, remaining: round2(global.amount_limit - total), pace: computePace(month, global.amount_limit, total, today) }
      : null,
    categories: status,
    sinking_funds: fundStatus,
  });
}));

const globalBudgetSchema = z.object({
  month: monthString,
  amount_limit: z.coerce.number().positive().transform(round2),
  recurring: z.preprocess((v) => (v === 'false' || v === '0' ? false : v), z.coerce.boolean()).optional(),
});

budgetsRouter.put('/users/:user_id/budgets/global', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = globalBudgetSchema.parse(req.body);
  const row = await prisma.globalBudget.upsert({
    where: { user_id_month: { user_id, month: body.month } },
    create: { user_id, month: body.month, amount_limit: body.amount_limit, recurring: body.recurring ?? true },
    update: { amount_limit: body.amount_limit, ...(body.recurring !== undefined ? { recurring: body.recurring } : {}) },
  });
  res.json(row);
}));

// Supprime le budget global du mois et arrête sa reconduction.
budgetsRouter.delete('/users/:user_id/budgets/global/:month', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.params.month);
  await prisma.$transaction([
    prisma.globalBudget.deleteMany({ where: { user_id, month } }),
    prisma.globalBudget.updateMany({ where: { user_id, month: { lt: month } }, data: { recurring: false } }),
  ]);
  res.json({ deleted: true });
}));

async function ensureRecurringGlobalBudget(user_id: number, month: string): Promise<void> {
  const existing = await prisma.globalBudget.findUnique({ where: { user_id_month: { user_id, month } } });
  if (existing) return;
  const latest = await prisma.globalBudget.findFirst({ where: { user_id, month: { lt: month } }, orderBy: { month: 'desc' } });
  if (latest?.recurring) {
    await prisma.globalBudget.createMany({ data: [{ user_id, month, amount_limit: latest.amount_limit, recurring: true }], skipDuplicates: true });
  }
}

function nextMonth(m: string): string {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7);
}

// Plafonds suggérés : médiane des 6 derniers mois complets, par catégorie de dépense.
budgetsRouter.get('/users/:user_id/budgets/suggestions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  const months = previousMonths(month, 6); // du plus récent au plus ancien
  const spend = await loadSpend(user_id, reportCurrency, months[0]!, months[months.length - 1]);
  const categories = spend.categories
    .filter((c) => c.type === 'expense')
    .map((c) => {
      const values = months.map((m) => spend.spentFor(m).get(c.id) ?? 0);
      const suggestion = suggestLimit(values);
      return suggestion ? { category_id: c.id, name: c.name, color: c.color, ...suggestion, history: values.map(round2).reverse() } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.suggested - a.suggested);
  res.json({ month, months: [...months].reverse(), categories, global: suggestLimit(months.map((m) => spend.totalFor(m))) });
}));

// Historique réel / plafond sur N mois (graphique et ajustement des plafonds).
budgetsRouter.get('/users/:user_id/budgets/history', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const month = monthString.parse(req.query.month ?? new Date().toISOString().slice(0, 7));
  const reportCurrency = currencyQuery.parse(req.query.currency ?? 'EUR');
  const count = z.coerce.number().int().min(1).max(24).parse(req.query.months ?? 6);
  const months = [month, ...previousMonths(month, count - 1)].reverse();
  const [spend, budgets, globals] = await Promise.all([
    loadSpend(user_id, reportCurrency, month, months[0]),
    prisma.budget.findMany({ where: { user_id, month: { in: months } } }),
    prisma.globalBudget.findMany({ where: { user_id, month: { in: months } } }),
  ]);
  res.json(months.map((m) => ({
    month: m,
    total_spent: round2(spend.totalFor(m)),
    global_limit: globals.find((g) => g.month === m)?.amount_limit ?? null,
    categories: budgets.filter((b) => b.month === m).map((b) => ({
      category_id: b.category_id,
      limit: b.amount_limit,
      spent: round2(spend.spentFor(m).get(b.category_id) ?? 0),
    })),
  })));
}));

// ---------------------------------------------------------------------------
// Provisions (dépenses irrégulières)
// ---------------------------------------------------------------------------

const sinkingFundSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category_id: z.coerce.number().int().positive().nullish(),
  target_amount: z.coerce.number().positive().transform(round2),
  period_months: z.coerce.number().int().min(1).max(120).default(12),
  start_month: monthString,
  color: z.string().trim().min(1).max(20).optional(),
});

async function assertFundCategory(user_id: number, category_id: number | null | undefined) {
  if (category_id == null) return;
  const c = await prisma.category.findFirst({ where: { id: category_id, user_id }, select: { type: true } });
  if (!c) throw new HttpError(400, 'Catégorie introuvable');
  if (c.type !== 'expense') throw new HttpError(400, 'Une provision se rattache à une catégorie de dépense');
}

budgetsRouter.get('/users/:user_id/sinking-funds', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.sinkingFund.findMany({ where: { user_id }, orderBy: { name: 'asc' } }));
}));

budgetsRouter.post('/users/:user_id/sinking-funds', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = sinkingFundSchema.parse(req.body);
  await assertFundCategory(user_id, body.category_id);
  res.status(201).json(await prisma.sinkingFund.create({ data: { user_id, ...body, category_id: body.category_id ?? null } }));
}));

budgetsRouter.patch('/users/:user_id/sinking-funds/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = sinkingFundSchema.partial().parse(req.body);
  await assertFundCategory(user_id, body.category_id);
  const result = await prisma.sinkingFund.updateMany({ where: { id, user_id }, data: body });
  if (result.count === 0) throw new HttpError(404, 'Provision introuvable');
  res.json(await prisma.sinkingFund.findUnique({ where: { id } }));
}));

budgetsRouter.delete('/users/:user_id/sinking-funds/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.sinkingFund.deleteMany({ where: { id, user_id } });
  if (result.count === 0) throw new HttpError(404, 'Provision introuvable');
  res.json({ deleted: true });
}));

// Alertes automatiques (sans configuration) : enveloppe ou budget global à
// ≥ 80 %, dépassement probable au rythme actuel, ou dépassé. Ids négatifs :
// elles ne correspondent à aucune ligne de la table alerts.
export async function budgetAlerts(user_id: number, month: string, reportCurrency: string) {
  await ensureRecurringGlobalBudget(user_id, month);
  const [{ status, spend }, global, categories] = await Promise.all([
    computeBudgetStatus(user_id, month, reportCurrency),
    prisma.globalBudget.findUnique({ where: { user_id_month: { user_id, month } } }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const fmt = (n: number) => `${round2(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${reportCurrency}`;
  const out: Array<{ id: number; type: 'budget'; severity: 'warning' | 'info'; message: string }> = [];
  const describe = (label: string, limit: number, spent: number, pace: ReturnType<typeof computePace>) => {
    if (pace.status === 'over') return { severity: 'warning' as const, message: `${label} : dépassé de ${fmt(spent - limit)} (${fmt(spent)} / ${fmt(limit)})` };
    if (pace.status === 'projected_over') return { severity: 'warning' as const, message: `${label} : au rythme actuel, ${fmt(pace.projected)} en fin de mois pour ${fmt(limit)} prévus` };
    if (pace.status === 'warning') return { severity: 'info' as const, message: `${label} : ${Math.round(pace.percent)} % consommés (${fmt(limit - spent)} restants)` };
    return null;
  };
  if (global) {
    const total = spend.totalFor(month);
    const d = describe('Budget du mois', global.amount_limit, total, computePace(month, global.amount_limit, total, todayUtc()));
    if (d) out.push({ id: -1_000_000 - global.id, type: 'budget', ...d });
  }
  for (const s of status) {
    const d = describe(`Budget ${nameOf.get(s.category_id) ?? 'catégorie'}`, s.effective_limit, s.spent, s.pace);
    if (d) out.push({ id: -s.id, type: 'budget', ...d });
  }
  return out;
}
