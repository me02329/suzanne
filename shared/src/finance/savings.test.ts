import { describe, expect, it } from 'vitest';
import { monthlySavingsRates, payYourselfFirst } from './savings';

describe('taux d\'épargne', () => {
  it('par mois, null sans revenu', () => {
    expect(monthlySavingsRates([{ month: '2026-09', income: 2000, expenses: 1500 }, { month: '2026-10', income: 0, expenses: 100 }]))
      .toEqual([{ month: '2026-09', rate: 0.25 }, { month: '2026-10', rate: null }]);
  });
});

describe('payYourselfFirst', () => {
  const incomes = [
    { date: '2026-08-28', amount: 2600 }, { date: '2026-09-28', amount: 2600 }, { date: '2026-10-28', amount: 2600 },
    { date: '2026-10-10', amount: 40 },
  ];
  it('repère un versement juste après la paie ou en début de mois', () => {
    const r = payYourselfFirst(['2026-08', '2026-09', '2026-10'], [
      { date: '2026-08-30', amount: 300, to: 'Livret A' },   // 2 jours après la paie
      { date: '2026-09-03', amount: 250, to: 'PEA' },        // début de mois
      { date: '2026-10-20', amount: 500, to: 'PEA' },        // ni l'un ni l'autre
    ], incomes);
    expect(r.count).toBe(2);
    expect(r.detail.map((d) => d.transfer?.amount ?? null)).toEqual([300, 250, null]);
    expect(r.typicalAmount).toBe(300);
    expect(r.destination).toBe('PEA');
  });
  it('aucun versement : compte nul', () => {
    expect(payYourselfFirst(['2026-10'], [], incomes)).toMatchObject({ count: 0, typicalAmount: null, destination: null });
  });
});
