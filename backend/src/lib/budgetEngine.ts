// Logique pure des budgets (testée sans base) : rythme de dépense, suggestions
// de plafond, provisions pour dépenses irrégulières.

export type PaceStatus = 'ok' | 'warning' | 'projected_over' | 'over';

export interface Pace {
  /** Part du mois écoulée (1 pour un mois passé, 0 pour un mois futur). */
  elapsed_ratio: number;
  /** Dépense projetée en fin de mois au rythme actuel. */
  projected: number;
  /** Consommation en % de la limite effective. */
  percent: number;
  status: PaceStatus;
  /** Ce qu'on peut encore dépenser par jour d'ici la fin du mois (mois en cours seulement). */
  daily_allowance: number | null;
  days_left: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Rythme d'une enveloppe. `today` = 'YYYY-MM-DD' (date locale de l'utilisateur
 * côté appelant, UTC par défaut). Pour le mois en cours, la projection
 * extrapole linéairement la dépense — mais pas avant le 3e jour (trop bruité :
 * un plein d'essence le 1er ne doit pas annoncer un dépassement).
 */
export function computePace(month: string, limit: number, spent: number, today: string): Pace {
  const total = daysInMonth(month);
  const currentMonth = today.slice(0, 7);
  let elapsedDays: number;
  if (month < currentMonth) elapsedDays = total;
  else if (month > currentMonth) elapsedDays = 0;
  else elapsedDays = Number(today.slice(8, 10));
  const elapsed_ratio = elapsedDays / total;
  const days_left = month === currentMonth ? total - elapsedDays + 1 : month > currentMonth ? total : 0;
  const projected = month === currentMonth && elapsedDays >= 3 ? round2(spent / elapsed_ratio) : round2(spent);
  const percent = limit > 0 ? round2((spent / limit) * 100) : spent > 0 ? 100 : 0;
  let status: PaceStatus = 'ok';
  if (spent > limit + 0.005) status = 'over';
  else if (month === currentMonth && projected > limit * 1.05) status = 'projected_over';
  else if (limit > 0 && spent / limit >= 0.8) status = 'warning';
  const daily_allowance = month === currentMonth && days_left > 0 ? round2(Math.max(0, limit - spent) / days_left) : null;
  return { elapsed_ratio: round2(elapsed_ratio), projected, percent, status, daily_allowance, days_left };
}

/** Mois précédents : ['2026-04', '2026-03', …] (n mois avant `month`, exclu). */
export function previousMonths(month: string, n: number): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export interface Suggestion { median: number; average: number; months_used: number; suggested: number }

/**
 * Plafond suggéré à partir des dépenses des mois passés : médiane (robuste à
 * un mois atypique) arrondie au multiple de 5 € supérieur. Les mois sans
 * aucune dépense comptent (0 €) seulement si la catégorie est habituelle
 * (dépense présente au moins la moitié des mois) ; sinon pas de suggestion.
 */
export function suggestLimit(monthlySpend: number[]): Suggestion | null {
  const values = monthlySpend.map((v) => Math.max(0, v));
  const nonZero = values.filter((v) => v > 0);
  if (nonZero.length === 0 || nonZero.length < values.length / 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const average = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    median: round2(median),
    average: round2(average),
    months_used: values.length,
    suggested: Math.max(5, Math.ceil(median / 5) * 5),
  };
}

export interface SinkingFundInput { target_amount: number; period_months: number; start_month: string }
export interface SinkingFundCycle {
  cycle_start: string;
  cycle_end: string;
  months_elapsed: number;
  monthly_contribution: number;
  accrued: number;
}

/**
 * Provision : un montant à réunir tous les `period_months` mois (ex. 1 200 €
 * par an pour les vacances), lissé en mensualités. Le cycle en cours est celui
 * qui contient `month` ; la cagnotte accumulée = mensualité × mois écoulés du
 * cycle (mois courant inclus).
 */
export function sinkingFundCycle(fund: SinkingFundInput, month: string): SinkingFundCycle {
  const toIndex = (m: string) => { const [y, mm] = m.split('-').map(Number) as [number, number]; return y * 12 + (mm - 1); };
  const fromIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
  const period = Math.max(1, Math.trunc(fund.period_months));
  const start = toIndex(fund.start_month);
  const current = toIndex(month);
  const offset = Math.max(0, current - start);
  const cycleStart = start + Math.floor(offset / period) * period;
  const months_elapsed = current < start ? 0 : current - cycleStart + 1;
  const monthly_contribution = round2(fund.target_amount / period);
  return {
    cycle_start: fromIndex(cycleStart),
    cycle_end: fromIndex(cycleStart + period - 1),
    months_elapsed,
    monthly_contribution,
    accrued: round2(Math.min(fund.target_amount, monthly_contribution * months_elapsed)),
  };
}
