import { describe, expect, it } from 'vitest';
import { exitTax, simulateCompoundGrowth } from './compound.js';

describe('simulateCompoundGrowth', () => {
  it('capital seul à 0 % = constant', () => {
    const r = simulateCompoundGrowth({ initialCapital: 1000, monthlyDeposit: 0, annualRatePercent: 0, years: 5 });
    expect(r.finalTotal).toBe(1000);
    expect(r.points).toHaveLength(6);
  });

  it('taux annuel effectif (composé mensuel)', () => {
    const r = simulateCompoundGrowth({ initialCapital: 1000, monthlyDeposit: 0, annualRatePercent: 7, years: 1 });
    expect(r.finalTotal).toBeCloseTo(1070, 6);
  });

  it('versements mensuels', () => {
    const r = simulateCompoundGrowth({ initialCapital: 0, monthlyDeposit: 100, annualRatePercent: 0, years: 2 });
    expect(r.finalContributed).toBe(2400);
    expect(r.finalInterest).toBe(0);
  });

  it('plafond PEA : les versements s’arrêtent', () => {
    const r = simulateCompoundGrowth({ initialCapital: 140_000, monthlyDeposit: 1000, annualRatePercent: 0, years: 2, ceiling: 150_000 });
    expect(r.finalContributed).toBe(150_000);
    expect(r.ceilingReachedMonth).toBe(10);
  });
});

describe('exitTax', () => {
  it('PEA de plus de 5 ans : prélèvements sociaux seuls', () => {
    const t = exitTax({ total: 20_000, contributed: 10_000, envelope: 'pea', holdingYears: 8, asOf: '2026-06-01' });
    expect(t.incomeTax).toBe(0);
    expect(t.socialTax).toBeCloseTo(1860, 6);
    expect(t.net).toBeCloseTo(18_140, 6);
  });
  it('compte-titres : PFU', () => {
    const t = exitTax({ total: 20_000, contributed: 10_000, envelope: 'cto', holdingYears: 8, asOf: '2025-06-01' });
    expect(t.total).toBeCloseTo(3000, 6);
  });
  it('pas d’impôt sur une perte', () => {
    expect(exitTax({ total: 9000, contributed: 10_000, envelope: 'pea', holdingYears: 2, asOf: '2025-06-01' }).total).toBe(0);
  });
});
