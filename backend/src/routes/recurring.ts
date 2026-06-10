import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { createRecurringSchema, idParam, updateRecurringSchema } from '../lib/validation.js';
import { dateKey, startOfUtcDay } from '../lib/dates.js';

export const recurringRouter = Router();

recurringRouter.get('/users/:user_id/recurring-transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.recurringTransaction.findMany({
    where: { user_id },
    orderBy: [{ active: 'desc' }, { id: 'desc' }],
  }));
}));

recurringRouter.post('/users/:user_id/recurring-transactions', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createRecurringSchema.parse(req.body);
  const row = await prisma.recurringTransaction.create({
    data: {
      user_id,
      account_id: body.account_id ?? null,
      category_id: body.category_id ?? null,
      amount: body.amount,
      type: body.type,
      description: body.description,
      frequency: body.frequency,
      interval: body.interval,
      day_of_month: body.day_of_month ?? null,
      month_of_year: body.month_of_year ?? null,
      active: body.active,
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
      ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
      ...(body.category_id !== undefined ? { category_id: body.category_id ?? null } : {}),
      ...(body.amount != null ? { amount: body.amount } : {}),
      ...(body.type != null ? { type: body.type } : {}),
      ...(body.description != null ? { description: body.description } : {}),
      ...(body.frequency != null ? { frequency: body.frequency } : {}),
      ...(body.interval != null ? { interval: body.interval } : {}),
      ...(body.day_of_month !== undefined ? { day_of_month: body.day_of_month ?? null } : {}),
      ...(body.month_of_year !== undefined ? { month_of_year: body.month_of_year ?? null } : {}),
      ...(body.active != null ? { active: body.active } : {}),
    },
  });
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

async function generateDueRecurringTransactionsUnlocked(user_id: number, today: Date): Promise<number> {
  const rows = await prisma.recurringTransaction.findMany({ where: { user_id, active: true } });
  let generated = 0;

  // Wrap each recurring row's "create N transactions + bump last_executed" in
  // a single DB transaction so a crash/double-click can't leave us with
  // generated rows but a stale last_executed (which would re-create them on
  // the next run = duplication). We also link each generated transaction to
  // its recurring source via recurring_transaction_id and pre-skip any
  // (recurring_id, date) pair that already exists — defensive dedup in case
  // the previous run was retried partially.
  for (const row of rows) {
    const dueDates = dueDatesFor(row.frequency, row.interval, row.day_of_month, row.month_of_year, row.last_executed, today);
    if (dueDates.length === 0) continue;

    const existing = await prisma.transaction.findMany({
      where: { user_id, recurring_transaction_id: row.id, date: { in: dueDates } },
      select: { date: true },
    });
    const alreadyGenerated = new Set(existing.map((e) => dateKey(e.date)));
    const newDates = dueDates.filter((d) => !alreadyGenerated.has(dateKey(d)));

    await prisma.$transaction([
      ...newDates.map((date) => prisma.transaction.create({
        data: {
          user_id,
          account_id: row.account_id,
          category_id: row.category_id,
          recurring_transaction_id: row.id,
          amount: row.amount,
          type: row.type,
          date,
          description: row.description,
        },
      })),
      prisma.recurringTransaction.update({
        where: { id: row.id },
        data: { last_executed: dueDates[dueDates.length - 1] },
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
