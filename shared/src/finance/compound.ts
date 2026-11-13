// Projection à intérêts composés (njord : lib/simulator.ts, pages Simulator et
// Scenarios), étendue : plafond de versements du PEA et net d'impôt à la sortie.

import { PEA_IR_EXEMPTION_YEARS, PEA_IR_RATE, socialTaxRateAt } from './pea.js';

export interface CompoundInput {
  initialCapital: number;
  monthlyDeposit: number;
  /** Rendement annuel en % (7 = 7 %/an), composé mensuellement. */
  annualRatePercent: number;
  years: number;
  /** Plafond des versements cumulés (capital initial inclus) ; null = sans plafond. */
  ceiling?: number | null;
}

export interface CompoundYearPoint {
  year: number;
  total: number;
  contributed: number;
  interest: number;
}

export interface CompoundResult {
  points: CompoundYearPoint[];
  finalTotal: number;
  finalContributed: number;
  finalInterest: number;
  /** Mois (depuis le début) où le plafond est atteint, null sinon. */
  ceilingReachedMonth: number | null;
}

export function simulateCompoundGrowth(input: CompoundInput): CompoundResult {
  const years = Math.max(0, Math.floor(input.years));
  const monthlyRate = (1 + input.annualRatePercent / 100) ** (1 / 12) - 1;
  const ceiling = input.ceiling ?? Infinity;
  let contributed = Math.min(input.initialCapital, ceiling);
  let capital = input.initialCapital;
  let ceilingReachedMonth: number | null = null;
  const points: CompoundYearPoint[] = [{ year: 0, total: capital, contributed: input.initialCapital, interest: 0 }];
  let contributedTotal = input.initialCapital;
  for (let y = 1; y <= years; y += 1) {
    for (let m = 0; m < 12; m += 1) {
      const room = Math.max(0, ceiling - contributed);
      const deposit = Math.max(0, Math.min(input.monthlyDeposit, room));
      if (deposit < input.monthlyDeposit && ceilingReachedMonth == null) ceilingReachedMonth = (y - 1) * 12 + m;
      contributed += deposit;
      contributedTotal += deposit;
      capital = (capital + deposit) * (1 + monthlyRate);
    }
    points.push({ year: y, total: capital, contributed: contributedTotal, interest: capital - contributedTotal });
  }
  const last = points[points.length - 1]!;
  return { points, finalTotal: last.total, finalContributed: last.contributed, finalInterest: last.interest, ceilingReachedMonth };
}

export interface ExitTax {
  gain: number;
  incomeTax: number;
  socialTax: number;
  total: number;
  net: number;
  socialRate: number;
  incomeRate: number;
}

/**
 * Impôt à la sortie (retrait total) : PEA de plus de 5 ans = prélèvements
 * sociaux seuls ; PEA de moins de 5 ans ou compte-titres = PFU (12,8 % + PS).
 * Taux des PS en vigueur à `asOf` (la loi future est inconnue).
 */
export function exitTax(input: { total: number; contributed: number; envelope: 'pea' | 'cto'; holdingYears: number; asOf: string }): ExitTax {
  const gain = Math.max(0, input.total - input.contributed);
  const socialRate = socialTaxRateAt(input.asOf).rate;
  const incomeRate = input.envelope === 'pea' && input.holdingYears >= PEA_IR_EXEMPTION_YEARS ? 0 : PEA_IR_RATE;
  const incomeTax = gain * incomeRate;
  const socialTax = gain * socialRate;
  const total = incomeTax + socialTax;
  return { gain, incomeTax, socialTax, total, net: input.total - total, socialRate, incomeRate };
}
