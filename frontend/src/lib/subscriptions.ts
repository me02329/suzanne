import { recurringMonthlyEquivalent, type RecurringTransaction } from '@suzanne-lite/shared';

// Cashflow-honest cadence buckets. We deliberately do NOT smear a yearly payment
// across the twelve months it never touches: the cash leaves the account once,
// in one month. So each cadence is shown in its own natural unit and the totals
// are never summed across buckets.
//   - monthly  : paid every month            -> €/mois
//   - periodic : paid less often than monthly -> €/an  (yearly, or "every N months")
//   - weekly   : paid several times a month   -> €/sem
export type Cadence = 'monthly' | 'periodic' | 'weekly';

export const CADENCE_ORDER: Cadence[] = ['monthly', 'periodic', 'weekly'];

export const CADENCE_META: Record<Cadence, { label: string; unit: string }> = {
  monthly: { label: 'Mensuels', unit: '/mois' },
  periodic: { label: 'Périodiques', unit: '/an' },
  weekly: { label: 'Hebdo', unit: '/sem' },
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function cadenceOf(r: Pick<RecurringTransaction, 'frequency' | 'interval'>): Cadence {
  if (r.frequency === 'weekly') return 'weekly';
  if (r.frequency === 'yearly') return 'periodic';
  // monthly frequency: every month is the monthly bucket, every N>1 months is a
  // lump that falls less often than monthly.
  return (r.interval ?? 1) > 1 ? 'periodic' : 'monthly';
}

// Magnitude of a recurring in the natural unit of its cadence, in its own
// currency: per month / per year / per week. Periodic uses the yearly total
// (monthly-equivalent × 12), which annualises "every N months" honestly without
// ever dividing into months.
export function cadenceAmount(r: Pick<RecurringTransaction, 'amount' | 'frequency' | 'interval'>): number {
  const cadence = cadenceOf(r);
  if (cadence === 'weekly') return round2(Math.abs(r.amount) / Math.max(1, r.interval ?? 1));
  if (cadence === 'periodic') return round2(recurringMonthlyEquivalent({ ...r, amount: Math.abs(r.amount) }) * 12);
  return round2(Math.abs(r.amount));
}

export interface CadenceRow {
  r: RecurringTransaction;
  native: number;      // magnitude in the recurring's own currency, cadence unit
  reportValue: number; // native converted to the report currency
}

export interface CadenceGroup {
  cadence: Cadence;
  label: string;
  unit: string;
  rows: CadenceRow[];  // active first, then by descending report value
  total: number;       // report currency, ACTIVE rows only
}

// Buckets recurring by cadence for display. Inactive recurring stay visible
// (so they can be re-enabled) but are excluded from the bucket total — a
// disabled subscription no longer costs anything.
export function groupByCadence(
  recurring: RecurringTransaction[],
  rateFor: (accountId: number | null) => number,
): CadenceGroup[] {
  const buckets = new Map<Cadence, CadenceRow[]>();
  for (const r of recurring) {
    const cadence = cadenceOf(r);
    const native = cadenceAmount(r);
    const list = buckets.get(cadence) ?? [];
    list.push({ r, native, reportValue: round2(native * rateFor(r.account_id)) });
    buckets.set(cadence, list);
  }
  return CADENCE_ORDER.filter((c) => buckets.has(c)).map((cadence) => {
    const rows = buckets.get(cadence)!.sort((a, b) =>
      Number(b.r.active) - Number(a.r.active) || b.reportValue - a.reportValue);
    const total = round2(rows.filter((x) => x.r.active).reduce((s, x) => s + x.reportValue, 0));
    return { cadence, ...CADENCE_META[cadence], rows, total };
  });
}

// Per-cadence totals (report currency) over the given recurring, in each
// cadence's own unit. Used for the at-a-glance summary line.
export function cadenceTotals(
  recurring: RecurringTransaction[],
  rateFor: (accountId: number | null) => number,
): Record<Cadence, number> {
  const totals: Record<Cadence, number> = { monthly: 0, periodic: 0, weekly: 0 };
  for (const r of recurring) totals[cadenceOf(r)] += cadenceAmount(r) * rateFor(r.account_id);
  return { monthly: round2(totals.monthly), periodic: round2(totals.periodic), weekly: round2(totals.weekly) };
}
