// Coût des frais d'un placement (calcul pur) : ce qu'ils prélèvent chaque
// année et ce qu'ils font perdre sur un horizon, intérêts composés compris.

export interface FeeImpact {
  /** Frais de l'année au niveau actuel du placement. */
  annualCost: number;
  /** Rendement annuel net de frais (brut − frais). */
  netReturn: number;
  /** Capital final sans frais / avec frais, versements mensuels compris. */
  finalWithoutFees: number;
  finalWithFees: number;
  /** Manque à gagner total dû aux frais sur l'horizon. */
  lost: number;
}

/** Capital au bout de `years` ans au taux annuel `rate`, avec un versement mensuel. */
export function futureValue(start: number, rate: number, years: number, monthly = 0): number {
  const r = Math.pow(1 + rate, 1 / 12) - 1;
  const n = Math.round(years * 12);
  const growth = Math.pow(1 + r, n);
  return start * growth + (r === 0 ? monthly * n : monthly * ((growth - 1) / r));
}

export function feeImpact(value: number, feeRate: number, opts: { grossReturn?: number; years?: number; monthly?: number } = {}): FeeImpact {
  const gross = opts.grossReturn ?? 0.07;
  const years = opts.years ?? 20;
  const monthly = opts.monthly ?? 0;
  const net = gross - feeRate;
  const finalWithoutFees = futureValue(value, gross, years, monthly);
  const finalWithFees = futureValue(value, net, years, monthly);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  return {
    annualCost: round2(value * feeRate),
    netReturn: net,
    finalWithoutFees: round2(finalWithoutFees),
    finalWithFees: round2(finalWithFees),
    lost: round2(finalWithoutFees - finalWithFees),
  };
}

/** Frais moyens pondérés par la valeur des placements (taux), null sans frais renseignés. */
export function weightedFeeRate(items: Array<{ value: number; feeRate: number | null | undefined }>): number | null {
  const known = items.filter((i) => i.feeRate != null && i.value > 0);
  const total = known.reduce((s, i) => s + i.value, 0);
  return total > 0 ? known.reduce((s, i) => s + i.value * (i.feeRate as number), 0) / total : null;
}
