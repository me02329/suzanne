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

// "Mai 2026", used as the dashboard section header for the month-scoped block.
export function formatMonthLong(month: string) {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  const formatted = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// Truncate long labels (account names, descriptions) for chart axes.
export function truncate(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// today()/currentMonth() are functions (not constants) so a long-running tab
// stays correct across midnight rollovers.
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthIso(): string {
  return new Date().toISOString().slice(0, 7);
}

// Last day of the previous month — used as the default snapshot date so a
// user opening the app on the 5th lands on the obvious "fin de mois précédent".
export function lastDayOfPreviousMonthIso(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const yyyy = last.getFullYear();
  const mm = String(last.getMonth() + 1).padStart(2, '0');
  const dd = String(last.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Formate une date `YYYY-MM-DD` en jj/mm/aaaa + écart relatif en jours.
// Renvoie aussi `days` (entier de jours depuis aujourd'hui) pour la mise en
// surbrillance des échéances proches.
export function formatRelativeDate(iso: string | null): { label: string; days: number | null } {
  if (!iso) return { label: '—', days: null };
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return { label: '—', days: null };
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target - today) / 86_400_000);
  const date = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  let rel: string;
  if (days === 0) rel = "aujourd'hui";
  else if (days === 1) rel = 'demain';
  else if (days > 1) rel = `dans ${days} jours`;
  else if (days === -1) rel = 'hier';
  else rel = `il y a ${-days} jours`;
  return { label: `${date} (${rel})`, days };
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
