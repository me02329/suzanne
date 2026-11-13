// Porté depuis njord (frontend/src/lib/xirr.ts).
export interface CashFlow {
  /** ISO date (YYYY-MM-DD or full ISO). */
  date: string;
  /** Negative for money paid in (contributions), positive for money received / current value. */
  amount: number;
}

const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function yearsBetween(from: number, to: number): number {
  return (to - from) / MS_PER_DAY / DAYS_PER_YEAR;
}

/**
 * Money-weighted annualized return (XIRR), the correct metric for a
 * dollar-cost-averaging portfolio where capital is added over time.
 *
 * Returns the rate as a percentage (e.g. 7.3 for +7.3 %/year), or `null`
 * when it cannot be computed (fewer than two flows, or all flows share the
 * same sign so no root exists).
 */
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;

  const times = flows.map((f) => new Date(f.date).getTime());
  const t0 = Math.min(...times);
  const amounts = flows.map((f) => f.amount);
  const years = times.map((t) => yearsBetween(t0, t));

  const hasPositive = amounts.some((a) => a > 0);
  const hasNegative = amounts.some((a) => a < 0);
  if (!hasPositive || !hasNegative) return null;

  const npv = (rate: number): number => {
    let sum = 0;
    for (let i = 0; i < amounts.length; i++) {
      sum += amounts[i]! / Math.pow(1 + rate, years[i]!);
    }
    return sum;
  };
  const dNpv = (rate: number): number => {
    let sum = 0;
    for (let i = 0; i < amounts.length; i++) {
      sum -= (years[i]! * amounts[i]!) / Math.pow(1 + rate, years[i]! + 1);
    }
    return sum;
  };

  // Newton-Raphson from a sensible starting guess.
  let rate = 0.1;
  for (let iter = 0; iter < 50; iter++) {
    const value = npv(rate);
    if (Math.abs(value) < 1e-7) return rate * 100;
    const slope = dNpv(rate);
    if (!Number.isFinite(slope) || slope === 0) break;
    const next = rate - value / slope;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-9) return next * 100;
    rate = next;
  }

  // Bisection fallback over a wide bracket (-99 % .. +1000 % / year).
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7 || (hi - lo) / 2 < 1e-9) return mid * 100;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return ((lo + hi) / 2) * 100;
}

/**
 * Convenience wrapper: build the cashflow set from contributions (paid in)
 * plus the current portfolio value as a terminal inflow, then solve XIRR.
 */
export function annualizedMoneyWeightedReturn(
  contributions: Array<{ date: string; amount: number }>,
  currentValue: number,
  asOf: string = new Date().toISOString().split('T')[0]!,
): number | null {
  if (contributions.length === 0 || currentValue <= 0) return null;
  const flows: CashFlow[] = contributions.map((c) => ({ date: c.date, amount: -c.amount }));
  flows.push({ date: asOf, amount: currentValue });
  return xirr(flows);
}
