import { describe, expect, it } from 'vitest';
import { billDueInMonth, billExpectedDate, billMatchesTransaction, billStatusForMonth, type BillCandidateTx, type BillShape } from './bills.js';

function bill(overrides: Partial<BillShape> = {}): BillShape {
  return {
    name: 'Électricité',
    amount_min: 80,
    amount_max: 130,
    start_date: new Date('2026-01-15T00:00:00.000Z'),
    frequency: 'monthly',
    interval: 1,
    pattern: 'EDF',
    account_id: null,
    category_id: null,
    active: true,
    ...overrides,
  };
}

function tx(overrides: Partial<BillCandidateTx> = {}): BillCandidateTx {
  return {
    id: 1,
    type: 'expense',
    amount: 95,
    date: new Date('2026-06-12T00:00:00.000Z'),
    description: 'Prélèvement EDF juin',
    account_id: null,
    category_id: null,
    ...overrides,
  };
}

describe('billDueInMonth', () => {
  it('est due chaque mois pour une mensuelle', () => {
    expect(billDueInMonth(bill(), '2026-06')).toBe(true);
    expect(billDueInMonth(bill(), '2026-01')).toBe(true);
  });

  it('jamais due avant le mois de départ ni si inactive', () => {
    expect(billDueInMonth(bill(), '2025-12')).toBe(false);
    expect(billDueInMonth(bill({ active: false }), '2026-06')).toBe(false);
  });

  it('respecte la cadence trimestrielle (interval 3)', () => {
    const quarterly = bill({ interval: 3 });
    expect(billDueInMonth(quarterly, '2026-01')).toBe(true);
    expect(billDueInMonth(quarterly, '2026-02')).toBe(false);
    expect(billDueInMonth(quarterly, '2026-04')).toBe(true);
  });

  it('une annuelle ne tombe que sur son mois anniversaire', () => {
    const yearly = bill({ frequency: 'yearly', start_date: new Date('2025-03-10T00:00:00.000Z') });
    expect(billDueInMonth(yearly, '2026-03')).toBe(true);
    expect(billDueInMonth(yearly, '2026-04')).toBe(false);
    expect(billDueInMonth(yearly, '2027-03')).toBe(true);
  });
});

describe('billExpectedDate', () => {
  it('reprend le jour de start_date', () => {
    expect(billExpectedDate(bill(), '2026-06')).toBe('2026-06-15');
  });

  it('clampe au dernier jour des mois plus courts', () => {
    const endOfMonth = bill({ start_date: new Date('2026-01-31T00:00:00.000Z') });
    expect(billExpectedDate(endOfMonth, '2026-02')).toBe('2026-02-28');
    expect(billExpectedDate(endOfMonth, '2026-04')).toBe('2026-04-30');
  });
});

describe('billMatchesTransaction', () => {
  it('matche sur le motif, insensible à la casse', () => {
    expect(billMatchesTransaction(bill(), tx({ description: 'edf facture' }))).toBe(true);
    expect(billMatchesTransaction(bill(), tx({ description: 'Carrefour' }))).toBe(false);
  });

  it('retombe sur le nom quand le motif est vide', () => {
    const noPattern = bill({ pattern: null });
    expect(billMatchesTransaction(noPattern, tx({ description: 'électricité mai' }))).toBe(true);
  });

  it('ignore revenus/transferts et respecte les filtres compte/catégorie', () => {
    expect(billMatchesTransaction(bill(), tx({ type: 'income' }))).toBe(false);
    expect(billMatchesTransaction(bill({ account_id: 2 }), tx({ account_id: 3 }))).toBe(false);
    expect(billMatchesTransaction(bill({ account_id: 2 }), tx({ account_id: 2 }))).toBe(true);
    expect(billMatchesTransaction(bill({ category_id: 5 }), tx({ category_id: 6 }))).toBe(false);
  });
});

describe('billStatusForMonth', () => {
  const today = new Date('2026-06-20T12:00:00.000Z');

  it('payée dans la fourchette', () => {
    const result = billStatusForMonth(bill(), [tx()], '2026-06', today);
    expect(result.status).toBe('paid');
    expect(result.paid_amount).toBe(95);
    expect(result.in_range).toBe(true);
    expect(result.matched_transactions).toHaveLength(1);
  });

  it('payée hors fourchette (cumul des matches)', () => {
    const result = billStatusForMonth(bill(), [tx(), tx({ id: 2, amount: 90 })], '2026-06', today);
    expect(result.status).toBe('paid_out_of_range');
    expect(result.paid_amount).toBe(185);
    expect(result.in_range).toBe(false);
  });

  it('en retard quand l’échéance est passée sans paiement', () => {
    const result = billStatusForMonth(bill(), [], '2026-06', today);
    expect(result.status).toBe('late');
    expect(result.expected_date).toBe('2026-06-15');
  });

  it('à venir quand l’échéance n’est pas atteinte', () => {
    const result = billStatusForMonth(bill({ start_date: new Date('2026-01-25T00:00:00.000Z') }), [], '2026-06', today);
    expect(result.status).toBe('pending');
  });

  it('non due hors cadence', () => {
    const result = billStatusForMonth(bill({ interval: 2 }), [tx()], '2026-02', today);
    expect(result.status).toBe('not_due');
    expect(result.due).toBe(false);
    expect(result.matched_transactions).toHaveLength(0);
  });
});
