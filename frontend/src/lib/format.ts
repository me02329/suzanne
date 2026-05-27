import type { Category, RecurringFrequency, Transaction, TransactionType } from '@suzanne-lite/shared';

export function money(value: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

// Compact format for chart axes: 1234 -> "1,2 k€", 1_500_000 -> "1,5 M€".
export function moneyCompact(value: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return money(value, currency);
  }
}

export function formatMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(date);
}

// today()/currentMonth() are functions (not constants) so a long-running tab
// stays correct across midnight rollovers.
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthIso(): string {
  return new Date().toISOString().slice(0, 7);
}

export function txLabel(t: Transaction, categoryById: Map<number, Category>) {
  return t.description || (t.type === 'transfer' ? 'Transfert' : categoryById.get(t.category_id ?? -1)?.name) || 'Transaction';
}

export function typeLabel(type: TransactionType) {
  if (type === 'income') return 'Revenu';
  if (type === 'transfer') return 'Transfert';
  return 'Dépense';
}

export function recurringFrequencyLabel(frequency: RecurringFrequency, interval: number) {
  const unit = frequency === 'weekly' ? 'semaine' : frequency === 'yearly' ? 'an' : 'mois';
  return interval <= 1 ? `Chaque ${unit}` : `Tous les ${interval} ${unit}${unit === 'mois' ? '' : 's'}`;
}
