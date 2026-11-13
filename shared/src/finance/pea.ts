// Règles du PEA : plafond, ancienneté fiscale, imposition d'un retrait.
// Porté et adapté depuis njord (frontend/src/lib/pea-fiscal.ts, projection.ts) :
// fonctions pures, la date de référence est toujours passée en paramètre.

/** Plafond des versements d'un PEA classique (versements bruts, hors gains). */
export const PEA_CEILING = 150_000;
/** Ancienneté à partir de laquelle les gains sont exonérés d'impôt sur le revenu. */
export const PEA_IR_EXEMPTION_YEARS = 5;
/** Prélèvement forfaitaire (IR) sur les gains d'un retrait avant 5 ans. */
export const PEA_IR_RATE = 0.128;

/**
 * Taux des prélèvements sociaux applicables aux gains du PEA, par date de retrait.
 * À VÉRIFIER : 17,2 % jusqu'au 31/12/2025, 18,6 % à partir du 01/01/2026
 * (hausse de la CSG sur les revenus du capital, LFSS 2026). Mettre à jour cette
 * table si la loi change ; l'UI affiche l'année du taux appliqué.
 */
export const SOCIAL_TAX_RATES: ReadonlyArray<{ from: string; rate: number }> = [
  { from: '0000-01-01', rate: 0.172 },
  { from: '2026-01-01', rate: 0.186 },
];

const MS_PER_DAY = 86_400_000;

function isoDay(date: string | Date): string {
  return (typeof date === 'string' ? date : date.toISOString()).slice(0, 10);
}

function utc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

/** Taux de prélèvements sociaux en vigueur à `date` (+ date d'entrée en vigueur). */
export function socialTaxRateAt(date: string | Date): { rate: number; from: string } {
  const day = isoDay(date);
  let current = SOCIAL_TAX_RATES[0]!;
  for (const entry of SOCIAL_TAX_RATES) if (entry.from <= day) current = entry;
  return current;
}

/** Ajoute `years` années à une date ISO (29/02 → 28/02 si besoin). */
export function addYearsIso(date: string, years: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const year = y! + years;
  const last = new Date(Date.UTC(year, m!, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d!, last)).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / MS_PER_DAY);
}

/** Nombre de mois entiers écoulés entre deux dates ISO. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number);
  let months = (ty! - fy!) * 12 + (tm! - fm!);
  if (td! < fd!) months -= 1;
  return Math.max(0, months);
}

export interface PeaFiscalStatus {
  openDate: string;
  /** Date des 5 ans : gains exonérés d'IR à partir de ce jour. */
  eligibilityDate: string;
  isEligible: boolean;
  ageDays: number;
  ageYears: number;
  daysToEligibility: number;
}

export function peaFiscalStatus(openDate: string, asOf: string): PeaFiscalStatus {
  const open = isoDay(openDate);
  const today = isoDay(asOf);
  const eligibilityDate = addYearsIso(open, PEA_IR_EXEMPTION_YEARS);
  const ageDays = Math.max(0, daysBetween(open, today));
  return {
    openDate: open,
    eligibilityDate,
    isEligible: today >= eligibilityDate,
    ageDays,
    ageYears: ageDays / 365.25,
    daysToEligibility: Math.max(0, daysBetween(today, eligibilityDate)),
  };
}

/**
 * Part de gain contenue dans un retrait : retrait × (valeur − versements nets) / valeur.
 * Négative en cas de moins-value latente (aucun impôt dans ce cas).
 */
export function withdrawalGain(withdrawal: number, value: number, netDeposits: number): number {
  if (value <= 0 || withdrawal <= 0) return 0;
  return (Math.min(withdrawal, value) * (value - netDeposits)) / value;
}

export interface WithdrawalTaxEstimate {
  withdrawal: number;
  gain: number;
  taxableGain: number;
  irRate: number;
  psRate: number;
  /** Date d'entrée en vigueur du taux de PS appliqué. */
  psRateFrom: string;
  ir: number;
  ps: number;
  total: number;
  /** Montant perçu après impôts. */
  net: number;
  /** Avant 5 ans, un retrait clôture le plan. */
  closesPlan: boolean;
  isEligible: boolean;
}

/**
 * Impôt estimé sur un retrait (total par défaut) d'un PEA à la date `asOf`.
 * - avant 5 ans : IR 12,8 % + prélèvements sociaux sur le gain, et le plan est clos ;
 * - à partir de 5 ans : prélèvements sociaux seuls.
 */
export function estimateWithdrawalTax(input: {
  value: number;
  netDeposits: number;
  openDate: string;
  asOf: string;
  withdrawal?: number;
}): WithdrawalTaxEstimate {
  const { value, netDeposits, openDate, asOf } = input;
  const withdrawal = Math.max(0, Math.min(input.withdrawal ?? value, value));
  const status = peaFiscalStatus(openDate, asOf);
  const gain = withdrawalGain(withdrawal, value, netDeposits);
  const taxableGain = Math.max(0, gain);
  const { rate: psRate, from: psRateFrom } = socialTaxRateAt(asOf);
  const irRate = status.isEligible ? 0 : PEA_IR_RATE;
  const ir = taxableGain * irRate;
  const ps = taxableGain * psRate;
  return {
    withdrawal,
    gain,
    taxableGain,
    irRate,
    psRate,
    psRateFrom,
    ir,
    ps,
    total: ir + ps,
    net: withdrawal - ir - ps,
    closesPlan: !status.isEligible,
    isEligible: status.isEligible,
  };
}

export interface CeilingProjection {
  remaining: number;
  monthsNeeded: number;
  /** Date ISO estimée d'atteinte du plafond. */
  date: string;
}

/**
 * Date d'atteinte du plafond au rythme mensuel donné (versements bruts).
 * `null` si le rythme est nul ; mois 0 si le plafond est déjà atteint.
 */
export function projectCeilingDate(
  grossDeposits: number,
  monthlyPace: number,
  asOf: string,
  ceiling = PEA_CEILING,
): CeilingProjection | null {
  const remaining = Math.max(0, ceiling - grossDeposits);
  if (remaining <= 0) return { remaining: 0, monthsNeeded: 0, date: isoDay(asOf) };
  if (!(monthlyPace > 0)) return null;
  const monthsNeeded = Math.ceil(remaining / monthlyPace);
  const [y, m, d] = isoDay(asOf).split('-').map(Number);
  const total = m! - 1 + monthsNeeded;
  const year = y! + Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d!, last)).padStart(2, '0')}`;
  return { remaining, monthsNeeded, date };
}

/**
 * Versement mensuel moyen sur les `months` derniers mois (fenêtre glissante).
 * Pour un plan plus jeune que la fenêtre, passer `elapsedMonths` (âge du plan) :
 * le diviseur est alors borné aux mois réellement écoulés.
 */
export function recentMonthlyAverage(
  deposits: ReadonlyArray<{ date: string; amount: number }>,
  asOf: string,
  months = 12,
  elapsedMonths?: number,
): number {
  if (deposits.length === 0) return 0;
  const end = isoDay(asOf);
  const [y, m, d] = end.split('-').map(Number);
  const total = m! - 1 - months;
  const cy = y! + Math.floor(total / 12);
  const cm = ((total % 12) + 12) % 12;
  const cutoff = `${cy}-${String(cm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const sum = deposits
    .filter((p) => p.amount > 0 && isoDay(p.date) > cutoff && isoDay(p.date) <= end)
    .reduce((s, p) => s + p.amount, 0);
  if (sum === 0) return 0;
  const divisor = elapsedMonths != null ? Math.max(1, Math.min(months, elapsedMonths)) : months;
  return sum / divisor;
}
