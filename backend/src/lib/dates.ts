export function fmtDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().split('T')[0] ?? null;
}

export function fmtDateRequired(date: Date): string {
  return date.toISOString().split('T')[0]!;
}
