import { describe, expect, it } from 'vitest';
import {
  PEA_CEILING,
  PEA_IR_RATE,
  addYearsIso,
  estimateWithdrawalTax,
  monthsBetween,
  peaFiscalStatus,
  projectCeilingDate,
  recentMonthlyAverage,
  socialTaxRateAt,
  withdrawalGain,
} from './pea.js';
import { envelopePerformance } from './performance.js';

describe('socialTaxRateAt', () => {
  it('applique 17,2 % jusqu’au 31/12/2025 puis 18,6 %', () => {
    expect(socialTaxRateAt('2025-12-31').rate).toBe(0.172);
    expect(socialTaxRateAt('2026-01-01').rate).toBe(0.186);
    expect(socialTaxRateAt('2026-01-01').from).toBe('2026-01-01');
  });
});

describe('peaFiscalStatus', () => {
  it('avant 5 ans : non éligible, date des 5 ans calculée', () => {
    const s = peaFiscalStatus('2024-01-01', '2026-05-25');
    expect(s.isEligible).toBe(false);
    expect(s.eligibilityDate).toBe('2029-01-01');
    expect(s.daysToEligibility).toBeGreaterThan(900);
  });

  it('éligible le jour des 5 ans', () => {
    const s = peaFiscalStatus('2020-01-01', '2025-01-01');
    expect(s.isEligible).toBe(true);
    expect(s.daysToEligibility).toBe(0);
  });

  it('gère le 29 février', () => {
    expect(addYearsIso('2024-02-29', 5)).toBe('2029-02-28');
  });
});

describe('withdrawalGain', () => {
  it('proratise le gain : retrait × (valeur − versements nets) / valeur', () => {
    expect(withdrawalGain(1000, 10000, 8000)).toBeCloseTo(200, 6);
  });
  it('négatif en moins-value, nul sans valeur', () => {
    expect(withdrawalGain(1000, 10000, 12000)).toBeCloseTo(-200, 6);
    expect(withdrawalGain(1000, 0, 0)).toBe(0);
  });
});

describe('estimateWithdrawalTax', () => {
  it('avant 5 ans : IR 12,8 % + PS, clôture le plan', () => {
    const e = estimateWithdrawalTax({ value: 12000, netDeposits: 10000, openDate: '2024-01-01', asOf: '2026-06-01' });
    expect(e.gain).toBeCloseTo(2000, 6);
    expect(e.ir).toBeCloseTo(2000 * PEA_IR_RATE, 6);
    expect(e.ps).toBeCloseTo(2000 * 0.186, 6);
    expect(e.closesPlan).toBe(true);
    expect(e.net).toBeCloseTo(12000 - e.total, 6);
  });

  it('après 5 ans : PS seuls (taux de la date du retrait)', () => {
    const e = estimateWithdrawalTax({ value: 12000, netDeposits: 10000, openDate: '2019-01-01', asOf: '2025-06-01' });
    expect(e.ir).toBe(0);
    expect(e.ps).toBeCloseTo(2000 * 0.172, 6);
    expect(e.closesPlan).toBe(false);
  });

  it('retrait partiel : seul le gain proratisé est taxé', () => {
    const e = estimateWithdrawalTax({ value: 10000, netDeposits: 8000, openDate: '2019-01-01', asOf: '2026-06-01', withdrawal: 1000 });
    expect(e.taxableGain).toBeCloseTo(200, 6);
    expect(e.ps).toBeCloseTo(200 * 0.186, 6);
  });

  it('aucun impôt en moins-value', () => {
    const e = estimateWithdrawalTax({ value: 9000, netDeposits: 10000, openDate: '2024-01-01', asOf: '2026-06-01' });
    expect(e.total).toBe(0);
    expect(e.net).toBe(9000);
  });
});

describe('projectCeilingDate', () => {
  it('null sans rythme de versement', () => {
    expect(projectCeilingDate(1000, 0, '2026-01-15')).toBeNull();
  });
  it('plafond atteint : 0 mois', () => {
    expect(projectCeilingDate(PEA_CEILING, 500, '2026-01-15')?.monthsNeeded).toBe(0);
  });
  it('projette la date au rythme courant', () => {
    const p = projectCeilingDate(PEA_CEILING - 1000, 400, '2026-01-31');
    expect(p?.monthsNeeded).toBe(3);
    expect(p?.date).toBe('2026-04-30');
  });
});

describe('recentMonthlyAverage', () => {
  const deposits = [
    { date: '2025-03-10', amount: 300 },
    { date: '2025-09-10', amount: 300 },
    { date: '2026-01-10', amount: 600 },
    { date: '2024-01-10', amount: 9999 },
  ];
  it('moyenne sur la fenêtre de 12 mois', () => {
    expect(recentMonthlyAverage(deposits, '2026-02-01')).toBeCloseTo(1200 / 12, 6);
  });
  it('plan jeune : diviseur borné à son âge', () => {
    expect(recentMonthlyAverage([{ date: '2026-01-10', amount: 600 }], '2026-02-15', 12, 2)).toBeCloseTo(300, 6);
  });
  it('ignore les retraits', () => {
    expect(recentMonthlyAverage([{ date: '2026-01-10', amount: -600 }], '2026-02-15')).toBe(0);
  });
});

describe('monthsBetween', () => {
  it('compte les mois entiers', () => {
    expect(monthsBetween('2025-01-15', '2025-03-14')).toBe(1);
    expect(monthsBetween('2025-01-15', '2025-03-15')).toBe(2);
  });
});

describe('envelopePerformance', () => {
  it('moins d’un an : performance cumulée', () => {
    const p = envelopePerformance([{ date: '2026-01-01', amount: 1000 }], 1100, '2026-06-01');
    expect(p.kind).toBe('cumulative');
    expect(p.rate).toBeCloseTo(10, 6);
  });
  it('au-delà : XIRR', () => {
    const p = envelopePerformance([{ date: '2023-01-01', amount: 100 }], 200, '2024-01-01');
    expect(p.kind).toBe('xirr');
    expect(p.rate!).toBeCloseTo(100, 1);
  });
  it('un retrait réduit les versements nets', () => {
    const p = envelopePerformance([{ date: '2022-01-01', amount: 1000 }, { date: '2023-01-01', amount: -200 }], 900, '2024-01-01');
    expect(p.netDeposits).toBe(800);
    expect(p.gain).toBe(100);
    expect(p.rate!).toBeGreaterThan(0);
  });
});
