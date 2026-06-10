export function fmtDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().split('T')[0] ?? null;
}

export function fmtDateRequired(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

// Alias sémantique utilisé par les agrégations (clé de bucket YYYY-MM-DD).
export const dateKey = fmtDateRequired;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Décale de N mois en conservant le jour (un 31 sur un mois court déborde sur
// le mois suivant — sémantique JS standard, suffisante pour des bornes de plage).
export function addMonthsUtc(date: Date, months: number): Date {
  const out = startOfUtcDay(date);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}
