import { describe, expect, it } from 'vitest';
import { feeImpact, futureValue, weightedFeeRate } from './fees';

describe('frais', () => {
  it('capital composé, avec et sans versements', () => {
    expect(futureValue(10_000, 0.07, 10)).toBeCloseTo(19_671.5, 0);
    expect(futureValue(0, 0, 2, 100)).toBe(2_400);
  });

  it('10 000 € sur 20 ans à 7 % : 0,6 % de frais contre 2,5 %', () => {
    const low = feeImpact(10_000, 0.006);
    const high = feeImpact(10_000, 0.025);
    expect(low.annualCost).toBe(60);
    expect(low.finalWithoutFees).toBeCloseTo(38_697, 0);
    expect(low.finalWithFees).toBeCloseTo(34_580.6, 0);
    expect(high.finalWithFees).toBeCloseTo(24_117, -1);
    expect(high.lost).toBeGreaterThan(low.lost);
    expect(high.netReturn).toBeCloseTo(0.045);
  });

  it('frais moyens pondérés, en ignorant les comptes sans frais renseignés', () => {
    expect(weightedFeeRate([{ value: 3_000, feeRate: 0.002 }, { value: 1_000, feeRate: 0.01 }, { value: 5_000, feeRate: null }])).toBeCloseTo(0.004);
    expect(weightedFeeRate([{ value: 100, feeRate: null }])).toBeNull();
  });
});
