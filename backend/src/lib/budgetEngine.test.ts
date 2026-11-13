import { describe, expect, it } from 'vitest';
import { computePace, previousMonths, sinkingFundCycle, suggestLimit } from './budgetEngine';

describe('computePace', () => {
  it('projette la fin du mois au rythme actuel et donne une enveloppe journalière', () => {
    const p = computePace('2026-11', 300, 150, '2026-11-10');
    expect(p.projected).toBe(450);
    expect(p.status).toBe('projected_over');
    expect(p.days_left).toBe(21);
    expect(p.daily_allowance).toBe(7.14);
  });

  it("n'extrapole pas les deux premiers jours", () => {
    expect(computePace('2026-11', 300, 80, '2026-11-02').status).toBe('ok');
  });

  it('distingue attention (≥ 80 %) et dépassement', () => {
    expect(computePace('2026-10', 300, 250, '2026-11-10').status).toBe('warning');
    expect(computePace('2026-10', 300, 301, '2026-11-10').status).toBe('over');
    expect(computePace('2026-10', 300, 250, '2026-11-10').daily_allowance).toBeNull();
  });
});

describe('suggestLimit', () => {
  it('prend la médiane (robuste à un mois atypique) arrondie à 5 € au-dessus', () => {
    expect(suggestLimit([210, 190, 205, 900, 198, 202])?.suggested).toBe(205);
  });
  it('ne suggère rien pour une catégorie occasionnelle', () => {
    expect(suggestLimit([0, 0, 0, 120, 0, 0])).toBeNull();
  });
});

describe('sinkingFundCycle', () => {
  it('lisse un objectif annuel et repart à zéro à chaque cycle', () => {
    const fund = { target_amount: 1200, period_months: 12, start_month: '2026-01' };
    expect(sinkingFundCycle(fund, '2026-03')).toMatchObject({ cycle_start: '2026-01', cycle_end: '2026-12', months_elapsed: 3, monthly_contribution: 100, accrued: 300 });
    expect(sinkingFundCycle(fund, '2027-02')).toMatchObject({ cycle_start: '2027-01', months_elapsed: 2, accrued: 200 });
    expect(sinkingFundCycle(fund, '2025-12').accrued).toBe(0);
  });
});

describe('previousMonths', () => {
  it('remonte les mois en passant les années', () => {
    expect(previousMonths('2026-02', 3)).toEqual(['2026-01', '2025-12', '2025-11']);
  });
});
