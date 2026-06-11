import { nextRecurringOccurrence, type RecurringTransaction, type SavingsGoal } from '@suzanne-lite/shared';

// Forward-looking cashflow projection. Everything else in the app is
// backward-looking (statistics) or present-state (dashboard); this projects the
// liquid balance over a horizon from the active recurring transactions, so the
// user can spot an upcoming dip below zero before it happens.

export interface ForecastEvent {
  date: string;            // YYYY-MM-DD
  recurringId: number;
  description: string;
  type: 'income' | 'expense';
  amount: number;          // report currency, positive magnitude
  signed: number;          // +income / -expense, report currency
  accountId: number | null;
  categoryId: number | null;
  runningBalance: number;  // projected liquid balance right after this event
}

export interface ForecastSeriesPoint {
  date: string;
  balance: number;
}

export interface ForecastGoalDeadline {
  goalId: number;
  name: string;
  deadline: string;
  remaining: number;       // target - current, floored at 0
  color: string;
  days: number;            // whole days from today
}

export interface Forecast {
  from: string;
  to: string;
  startingBalance: number;
  endingBalance: number;
  lowestBalance: number;
  lowestDate: string | null;
  totalIncome: number;
  totalExpenses: number;
  events: ForecastEvent[];
  series: ForecastSeriesPoint[];
  goalDeadlines: ForecastGoalDeadline[];
}

export interface ForecastEventGroup {
  key: string;             // '2026-06' (month) ou date du lundi (week)
  label: string;           // 'Juin 2026' / 'Semaine du 16/06'
  events: ForecastEvent[];
  income: number;
  expenses: number;
  net: number;             // income - expenses
  endBalance: number;      // runningBalance du dernier événement du groupe
}

export interface ForecastInput {
  horizonDays: number;
  startingBalance: number;
  recurring: RecurringTransaction[];
  goals: SavingsGoal[];
  // Converts a recurring amount (in its account's currency) to the report
  // currency. The caller wires this to summary.exchange_rates.
  rateFor: (accountId: number | null) => number;
  now?: Date;              // injectable for tests
}

const DAY_MS = 86_400_000;
const round2 = (value: number) => Math.round(value * 100) / 100;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const startOfUtcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

// Every occurrence of a recurring strictly after today and up to horizonEnd.
// nextRecurringOccurrence only yields the *next* date from a reference, and a
// weekly series has no fixed phase, so we can't just advance a day cursor — that
// drifts. Instead we thread each found occurrence back in as last_executed,
// which anchors the following computation on the true cadence.
function expandOccurrences(recurring: RecurringTransaction, today: Date, horizonEnd: Date): string[] {
  const out: string[] = [];
  let shape: RecurringTransaction = recurring;
  // Hard cap guards against a pathological interval producing an endless loop.
  for (let i = 0; i < 2000; i++) {
    const next = nextRecurringOccurrence(shape, today);
    if (!next) break;
    const nextDate = new Date(`${next}T00:00:00.000Z`);
    if (nextDate > horizonEnd) break;
    out.push(next);
    shape = { ...recurring, last_executed: `${next}T00:00:00.000Z` };
  }
  return out;
}

// Monday of the week containing the given ISO date — stable grouping key for
// the 'week' mode, independent of the locale's first-day-of-week.
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return isoDay(new Date(d.getTime() - sinceMonday * DAY_MS));
}

function groupLabel(key: string, mode: 'week' | 'month'): string {
  if (mode === 'month') {
    const formatted = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })
      .format(new Date(`${key}-01T00:00:00.000Z`));
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }
  const [, m, d] = key.split('-');
  return `Semaine du ${d}/${m}`;
}

// Folds the (already chronological) event list into contiguous week/month
// buckets with per-bucket totals. The input order is preserved — events carry
// a cumulative runningBalance, so re-sorting would corrupt endBalance.
export function groupForecastEvents(events: ForecastEvent[], mode: 'week' | 'month'): ForecastEventGroup[] {
  const groups: ForecastEventGroup[] = [];
  for (const event of events) {
    const key = mode === 'month' ? event.date.slice(0, 7) : mondayOf(event.date);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: groupLabel(key, mode), events: [], income: 0, expenses: 0, net: 0, endBalance: 0 };
      groups.push(group);
    }
    group.events.push(event);
    if (event.type === 'income') group.income = round2(group.income + event.amount);
    else group.expenses = round2(group.expenses + event.amount);
    group.net = round2(group.income - group.expenses);
    group.endBalance = event.runningBalance;
  }
  return groups;
}

export function buildForecast({
  horizonDays,
  startingBalance,
  recurring,
  goals,
  rateFor,
  now = new Date(),
}: ForecastInput): Forecast {
  const today = startOfUtcDay(now);
  const horizonEnd = new Date(today.getTime() + horizonDays * DAY_MS);
  const from = isoDay(today);
  const to = isoDay(horizonEnd);

  // Flatten every active recurring into dated events, then sort chronologically
  // (ties broken by income-first so a same-day salary lifts the floor before a
  // debit is applied — the optimistic, less alarming ordering).
  const events: ForecastEvent[] = [];
  for (const r of recurring) {
    if (!r.active) continue;
    const amount = round2(Math.abs(r.amount) * rateFor(r.account_id));
    const signed = r.type === 'income' ? amount : -amount;
    for (const date of expandOccurrences(r, today, horizonEnd)) {
      events.push({
        date,
        recurringId: r.id,
        description: r.description,
        type: r.type,
        amount,
        signed,
        accountId: r.account_id,
        categoryId: r.category_id,
        runningBalance: 0, // filled below
      });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || b.signed - a.signed);

  let running = startingBalance;
  let lowestBalance = startingBalance;
  let lowestDate: string | null = null;
  let totalIncome = 0;
  let totalExpenses = 0;
  for (const event of events) {
    running = round2(running + event.signed);
    event.runningBalance = running;
    if (running < lowestBalance) {
      lowestBalance = running;
      lowestDate = event.date;
    }
    if (event.type === 'income') totalIncome += event.amount;
    else totalExpenses += event.amount;
  }
  const endingBalance = running;

  // Step series: start at today, one point per event-date (end-of-day balance),
  // then extend the flat line to the horizon end.
  const series: ForecastSeriesPoint[] = [{ date: from, balance: round2(startingBalance) }];
  for (let i = 0; i < events.length; i++) {
    const isLastOfDate = i + 1 >= events.length || events[i + 1]!.date !== events[i]!.date;
    if (isLastOfDate) series.push({ date: events[i]!.date, balance: events[i]!.runningBalance });
  }
  if (series[series.length - 1]!.date !== to) series.push({ date: to, balance: endingBalance });

  const goalDeadlines: ForecastGoalDeadline[] = goals
    .filter((g) => g.deadline && g.deadline.slice(0, 10) > from && g.deadline.slice(0, 10) <= to)
    .map((g) => {
      const deadline = g.deadline!.slice(0, 10);
      const days = Math.round((new Date(`${deadline}T00:00:00.000Z`).getTime() - today.getTime()) / DAY_MS);
      return {
        goalId: g.id,
        name: g.name,
        deadline,
        remaining: round2(Math.max(0, g.target_amount - g.current_amount)),
        color: g.color,
        days,
      };
    })
    .sort((a, b) => a.days - b.days);

  return {
    from,
    to,
    startingBalance: round2(startingBalance),
    endingBalance,
    lowestBalance,
    lowestDate,
    totalIncome: round2(totalIncome),
    totalExpenses: round2(totalExpenses),
    events,
    series,
    goalDeadlines,
  };
}
