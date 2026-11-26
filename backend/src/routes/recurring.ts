import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { nextRecurringOccurrence } from '@suzanne/shared';
import { assertAccountOwned, assertCategoryOwned } from '../lib/transactionHelpers.js';
import { createRecurringSchema, idParam, updateRecurringSchema } from '../lib/validation.js';
import { dateKey, startOfUtcDay } from '../lib/dates.js';
import { buildLines, linesCreateData, type BuiltLines } from '../lib/ledger.js';

export const recurringRouter = Router();

recurringRouter.get('/users/:user_id/recurring-transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.recurringTransaction.findMany({
    where: { user_id },
    orderBy: [{ active: 'desc' }, { id: 'desc' }],
  }));
}));

type RefFields = { type?: 'expense' | 'income' | 'transfer'; account_id?: number | null; to_account_id?: number | null; category_id?: number | null };

/**
 * Comptes et catégorie d'un récurrent, fusionnés avec l'existant (mise à
 * jour) puis vérifiés : appartiennent à l'utilisateur ; un virement a ses deux
 * comptes, distincts, et pas de catégorie ; une dépense / un revenu n'a pas de
 * compte d'arrivée.
 */
export async function recurringRefs(user_id: number, body: RefFields, existing?: RefFields) {
  const pick = <K extends keyof RefFields>(key: K) => (body[key] !== undefined ? body[key] ?? null : existing?.[key] ?? null);
  const type = (body.type ?? existing?.type ?? 'expense') as 'expense' | 'income' | 'transfer';
  const account_id = pick('account_id') as number | null;
  let to_account_id = pick('to_account_id') as number | null;
  let category_id = pick('category_id') as number | null;
  if (type === 'transfer') {
    if (account_id == null || to_account_id == null) throw new HttpError(400, 'Un virement récurrent a besoin d’un compte de départ et d’un compte d’arrivée');
    if (account_id === to_account_id) throw new HttpError(400, 'Les deux comptes du virement doivent être différents');
    category_id = null;
  } else {
    to_account_id = null;
  }
  if (account_id != null) await assertAccountOwned(user_id, account_id);
  if (to_account_id != null) await assertAccountOwned(user_id, to_account_id, 'Compte d’arrivée');
  if (category_id != null) await assertCategoryOwned(user_id, category_id);
  return { type, account_id, to_account_id, category_id };
}

recurringRouter.post('/users/:user_id/recurring-transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createRecurringSchema.parse(req.body);
  const row = await prisma.recurringTransaction.create({
    data: {
      user_id,
      ...(await recurringRefs(user_id, body)),
      amount: body.amount,
      description: body.description,
      frequency: body.frequency,
      interval: body.interval,
      day_of_month: body.day_of_month ?? null,
      month_of_year: body.month_of_year ?? null,
      active: body.active,
      end_date: body.end_date ? new Date(body.end_date) : null,
    },
  });
  res.status(201).json(row);
}));

recurringRouter.patch('/users/:user_id/recurring-transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const body = updateRecurringSchema.parse(req.body);
  const existing = await prisma.recurringTransaction.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const row = await prisma.recurringTransaction.update({
    where: { id },
    data: {
      ...(await recurringRefs(user_id, body, existing)),
      ...(body.amount != null ? { amount: body.amount } : {}),
      ...(body.description != null ? { description: body.description } : {}),
      ...(body.frequency != null ? { frequency: body.frequency } : {}),
      ...(body.interval != null ? { interval: body.interval } : {}),
      ...(body.day_of_month !== undefined ? { day_of_month: body.day_of_month ?? null } : {}),
      ...(body.month_of_year !== undefined ? { month_of_year: body.month_of_year ?? null } : {}),
      ...(body.active != null ? { active: body.active } : {}),
      ...(body.end_date !== undefined ? { end_date: body.end_date ? new Date(body.end_date) : null } : {}),
    },
  });
  res.json(row);
}));

// Sauter la prochaine occurrence : avance `last_executed` jusqu'à l'occurrence
// qui serait générée ensuite, sans créer de transaction. S'il existe des
// occurrences en retard non générées, on n'en saute qu'une (la plus ancienne) ;
// sinon on saute la prochaine occurrence future.
recurringRouter.post('/users/:user_id/recurring-transactions/:id/skip', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const existing = await prisma.recurringTransaction.findFirst({ where: { id, user_id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const today = new Date();
  const overdue = dueDatesFor(existing.frequency, existing.interval, existing.day_of_month, existing.month_of_year, existing.last_executed, today);
  let skipDate: Date | null = null;
  if (overdue.length > 0) {
    skipDate = overdue[0]!;
  } else {
    const nextIso = nextRecurringOccurrence({
      frequency: existing.frequency as 'weekly' | 'monthly' | 'yearly',
      interval: existing.interval,
      day_of_month: existing.day_of_month,
      month_of_year: existing.month_of_year,
      last_executed: existing.last_executed ? existing.last_executed.toISOString() : null,
    });
    if (nextIso) skipDate = new Date(`${nextIso}T00:00:00.000Z`);
  }
  if (!skipDate || (existing.end_date && skipDate > existing.end_date)) {
    res.status(400).json({ error: 'Aucune occurrence à venir à sauter' });
    return;
  }
  const row = await prisma.recurringTransaction.update({ where: { id }, data: { last_executed: skipDate } });
  res.json(row);
}));

recurringRouter.delete('/users/:user_id/recurring-transactions/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.recurringTransaction.deleteMany({ where: { id, user_id } });
  if (result.count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json({ deleted: true });
}));

recurringRouter.post('/users/:user_id/recurring-transactions/generate', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const today = new Date();
  const generated = await generateDueRecurringTransactions(user_id, today);
  res.json({ generated });
}));

// Verrou en mémoire par utilisateur : le run quotidien du scheduler et le
// bouton « Générer ce mois » peuvent se chevaucher, et la déduplication
// (recurring_id, date) est un read-then-write — on sérialise donc les
// générations d'un même utilisateur (suffisant en instance unique).
const generationLocks = new Map<number, Promise<number>>();

export async function generateDueRecurringTransactions(user_id: number, today: Date): Promise<number> {
  const previous = generationLocks.get(user_id) ?? Promise.resolve(0);
  const next = previous.catch(() => 0).then(() => generateDueRecurringTransactionsUnlocked(user_id, today));
  generationLocks.set(user_id, next);
  try {
    return await next;
  } finally {
    if (generationLocks.get(user_id) === next) generationLocks.delete(user_id);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Une opération déjà là (saisie, import, banque) jusqu'à 3 jours avant ou 5
// jours après la date prévue est l'occurrence : on la rattache au lieu d'en
// créer une seconde. Un prélèvement arrive souvent un ou deux jours ouvrés
// après la date contractuelle, parfois plus autour d'un week-end férié.
export const ADOPT_BEFORE_DAYS = 3;
export const ADOPT_AFTER_DAYS = 5;

type RecurringRow = Awaited<ReturnType<typeof prisma.recurringTransaction.findMany>>[number];

/**
 * Cherche, pour une occurrence, une opération existante à rattacher : même
 * compte, même montant signé, dans la fenêtre, pas déjà rattachée à un
 * récurrent ni retenue pour une autre occurrence de ce passage.
 */
async function findAdoptable(user_id: number, row: RecurringRow, due: Date, claimed: Set<number>) {
  if (row.account_id == null) return null;
  const signed = row.type === 'income' ? row.amount : -row.amount;
  const candidates = await prisma.transaction.findMany({
    where: {
      user_id,
      recurring_transaction_id: null,
      kind: row.type === 'transfer' ? { in: ['standard', 'transfer'] } : 'standard',
      date: { gte: new Date(due.getTime() - ADOPT_BEFORE_DAYS * DAY_MS), lte: new Date(due.getTime() + ADOPT_AFTER_DAYS * DAY_MS) },
      lines: { some: { account_id: row.account_id } },
    },
    select: { id: true, date: true, kind: true, lines: { select: { id: true, account_id: true, amount: true, category_id: true } } },
  });
  const fits = (c: (typeof candidates)[number]) => {
    const own = c.lines.filter((l) => l.account_id === row.account_id);
    if (Math.abs(own.reduce((s, l) => s + l.amount, 0) - signed) >= 0.005) return false;
    // Virement attendu : soit déjà ce virement (même compte d'arrivée), soit une
    // simple sortie du compte de départ (la banque ne voit que ce côté-là), qui
    // deviendra le virement.
    if (row.type === 'transfer') {
      return c.kind === 'transfer'
        ? c.lines.some((l) => l.account_id === row.to_account_id)
        : c.lines.length === 1;
    }
    return c.lines.every((l) => l.account_id === row.account_id);
  };
  return candidates
    .filter((c) => !claimed.has(c.id) && fits(c))
    .sort((a, b) => Math.abs(a.date.getTime() - due.getTime()) - Math.abs(b.date.getTime() - due.getTime()))[0] ?? null;
}

async function generateDueRecurringTransactionsUnlocked(user_id: number, today: Date): Promise<number> {
  const rows = await prisma.recurringTransaction.findMany({ where: { user_id, active: true } });
  let generated = 0;
  // Comptes alimentés par la synchro bancaire : la banque fait foi, on attend
  // son opération plutôt que d'en inventer une (voir plus bas).
  const synced = new Set((await prisma.bankLink.findMany({
    where: { user_id, account_id: { not: null }, connection: { status: 'active' } },
    select: { account_id: true },
  })).map((l) => l.account_id!));
  const claimed = new Set<number>();

  // Wrap each recurring row's "create N transactions + bump last_executed" in
  // a single DB transaction so a crash/double-click can't leave us with
  // generated rows but a stale last_executed (which would re-create them on
  // the next run = duplication). We also link each generated transaction to
  // its recurring source via recurring_transaction_id and pre-skip any
  // (recurring_id, date) pair that already exists — defensive dedup in case
  // the previous run was retried partially.
  for (const row of rows) {
    const allDue = dueDatesFor(row.frequency, row.interval, row.day_of_month, row.month_of_year, row.last_executed, today);
    // Date de fin : on ne génère rien au-delà, et une fois la date passée la
    // récurrence se désactive (plus aucune occurrence ne viendra jamais).
    const dueDates = row.end_date ? allDue.filter((d) => d <= row.end_date!) : allDue;
    if (dueDates.length === 0) {
      if (row.end_date && startOfUtcDay(today) > row.end_date) {
        await prisma.recurringTransaction.update({ where: { id: row.id }, data: { active: false } });
      }
      continue;
    }

    const existing = await prisma.transaction.findMany({
      where: { user_id, recurring_transaction_id: row.id, date: { in: dueDates } },
      select: { date: true },
    });
    const alreadyGenerated = new Set(existing.map((e) => dateKey(e.date)));

    // Chaque occurrence : déjà là (rattachée), à rattacher (opération existante),
    // à attendre (compte synchronisé, banque pas encore passée) ou à créer.
    // On s'arrête à la première occurrence en attente : last_executed ne
    // dépasse jamais une occurrence non résolue.
    const adoptions: Array<{ id: number; kind: string; lines: Array<{ id: number; account_id: number | null; amount: number; category_id: number | null }> }> = [];
    const newDates: Date[] = [];
    let resolvedUntil: Date | null = null;
    for (const due of dueDates) {
      if (alreadyGenerated.has(dateKey(due))) { resolvedUntil = due; continue; }
      const match = await findAdoptable(user_id, row, due, claimed);
      if (match) {
        claimed.add(match.id);
        adoptions.push(match);
        resolvedUntil = due;
        continue;
      }
      const waitForBank = row.account_id != null && synced.has(row.account_id)
        && today.getTime() < due.getTime() + (ADOPT_AFTER_DAYS + 1) * DAY_MS;
      if (waitForBank) break;
      newDates.push(due);
      resolvedUntil = due;
    }
    if (resolvedUntil == null) continue;

    // Le modèle (type / montant / compte / catégorie) devient une opération à
    // lignes via buildLines, comme une saisie manuelle. Un modèle devenu
    // invalide est sauté (journalisé) sans bloquer les autres.
    let built: BuiltLines | null = null;
    if (newDates.length > 0) {
      try {
        built = await buildLines(prisma, user_id, {
          type: row.type,
          amount: row.amount,
          account_id: row.account_id,
          category_id: row.category_id,
          to_account_id: row.to_account_id,
          date: dateKey(newDates[0]!),
        });
      } catch (e) {
        console.error('[recurring] modèle invalide, occurrence non générée', { recurring_id: row.id, detail: (e as Error).message });
        continue;
      }
    }

    await prisma.$transaction([
      // Opération rattachée : elle garde son libellé, sa date et son montant
      // réels ; elle reçoit la catégorie du modèle si elle n'en avait pas.
      ...adoptions.flatMap((match) => {
        // Virement attendu, et la banque n'a apporté que la sortie : l'opération
        // devient le virement (ligne d'arrivée ajoutée, plus de catégorie —
        // ce n'est ni une dépense ni un revenu).
        if (row.type === 'transfer' && match.kind !== 'transfer') {
          return [
            prisma.transaction.update({ where: { id: match.id }, data: { recurring_transaction_id: row.id, kind: 'transfer' } }),
            prisma.transactionLine.updateMany({ where: { transaction_id: match.id }, data: { category_id: null, refund: false } }),
            prisma.transactionLine.create({ data: { user_id, transaction_id: match.id, account_id: row.to_account_id, amount: row.amount, position: 1 } }),
          ];
        }
        return [
          prisma.transaction.update({ where: { id: match.id }, data: { recurring_transaction_id: row.id } }),
          ...(row.type !== 'transfer' && row.category_id != null && match.lines.every((l) => l.category_id == null)
            ? [prisma.transactionLine.updateMany({ where: { transaction_id: match.id }, data: { category_id: row.category_id } })]
            : []),
        ];
      }),
      ...newDates.map((date) => prisma.transaction.create({
        data: {
          user_id,
          kind: built!.kind,
          recurring_transaction_id: row.id,
          date,
          description: row.description,
          lines: { create: linesCreateData(user_id, built!) },
        },
      })),
      prisma.recurringTransaction.update({
        where: { id: row.id },
        data: {
          last_executed: resolvedUntil,
          // Dernière occurrence atteinte/dépassée et résolue : on désactive (plus rien à venir).
          ...(row.end_date && startOfUtcDay(today) >= row.end_date && resolvedUntil.getTime() === dueDates[dueDates.length - 1]!.getTime() ? { active: false } : {}),
        },
      }),
    ]);
    generated += newDates.length;
  }

  return generated;
}

// Exporté pour les tests unitaires (pur, pas d'accès DB).
export function dueDatesFor(
  frequency: string,
  interval: number,
  dayOfMonth: number | null,
  monthOfYear: number | null,
  lastExecuted: Date | null,
  today: Date,
): Date[] {
  const dates: Date[] = [];
  const step = Math.max(1, interval);
  const lastKey = lastExecuted ? dateKey(lastExecuted) : null;

  if (frequency === 'weekly') {
    const cursor = lastExecuted ? addDays(lastExecuted, 7 * step) : startOfUtcDay(today);
    while (cursor <= today) {
      if (!lastKey || dateKey(cursor) > lastKey) dates.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 7 * step);
    }
    return dates;
  }

  if (frequency === 'monthly') {
    const cursor = lastExecuted
      ? addMonths(lastExecuted, step)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    while (cursor <= today) {
      const due = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(dayOfMonth ?? 1, daysInMonth(cursor))));
      if (due <= today && (!lastKey || dateKey(due) > lastKey)) dates.push(due);
      cursor.setUTCMonth(cursor.getUTCMonth() + step, 1);
    }
    return dates;
  }

  if (frequency === 'yearly') {
    // Ancrage sur month_of_year quand il est défini (« chaque mars »), sinon
    // sur le mois de la dernière exécution, à défaut le mois courant — aligné
    // sur nextRecurringOccurrence du shared, qui pilote l'affichage.
    const month = monthOfYear != null
      ? monthOfYear - 1
      : (lastExecuted ? lastExecuted.getUTCMonth() : today.getUTCMonth());
    const day = dayOfMonth ?? (lastExecuted ? lastExecuted.getUTCDate() : 1);
    let year = lastExecuted ? lastExecuted.getUTCFullYear() + step : today.getUTCFullYear();
    for (;;) {
      const due = new Date(Date.UTC(year, month, Math.min(day, daysInMonthYM(year, month))));
      if (due > today) break;
      if (!lastKey || dateKey(due) > lastKey) dates.push(due);
      year += step;
    }
  }
  return dates;
}

function daysInMonthYM(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addDays(date: Date, days: number): Date {
  const out = startOfUtcDay(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function addMonths(date: Date, months: number): Date {
  const out = startOfUtcDay(date);
  out.setUTCMonth(out.getUTCMonth() + months, 1);
  return out;
}

function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}
