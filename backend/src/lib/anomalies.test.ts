import { describe, it, expect } from 'vitest';
import { detectAnomalies, type AnomalyTx } from './anomalies';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const tx = (over: Partial<AnomalyTx> & { id: number }): AnomalyTx => ({
  date: d('2026-06-01'), amount: 10, type: 'expense', description: null, account_id: 1, category_id: 5, ...over,
});

describe('detectAnomalies', () => {
  it('flags flow transactions without an account, ignoring transfers', () => {
    const r = detectAnomalies([
      tx({ id: 1, account_id: null }),
      tx({ id: 2, type: 'transfer', account_id: null }),
      tx({ id: 3, account_id: 1 }),
    ]);
    expect(r.no_account.map((t) => t.id)).toEqual([1]);
  });

  it('flags flow transactions without a category, ignoring transfers', () => {
    const r = detectAnomalies([
      tx({ id: 1, category_id: null }),
      tx({ id: 2, type: 'transfer', category_id: null }),
      tx({ id: 3, category_id: 5 }),
    ]);
    expect(r.no_category.map((t) => t.id)).toEqual([1]);
  });

  it('pairs same-account same-amount transactions within the window', () => {
    const r = detectAnomalies([
      tx({ id: 1, amount: 42, date: d('2026-06-01') }),
      tx({ id: 2, amount: 42, date: d('2026-06-02') }),
    ]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]!.days_apart).toBe(1);
  });

  it('does not pair when dates are too far apart', () => {
    const r = detectAnomalies([
      tx({ id: 1, amount: 42, date: d('2026-06-01') }),
      tx({ id: 2, amount: 42, date: d('2026-06-10') }),
    ]);
    expect(r.duplicates).toHaveLength(0);
  });

  it('does not pair different amounts or accounts', () => {
    const r = detectAnomalies([
      tx({ id: 1, amount: 42, account_id: 1 }),
      tx({ id: 2, amount: 42, account_id: 2 }),
      tx({ id: 3, amount: 43, account_id: 1 }),
    ]);
    expect(r.duplicates).toHaveLength(0);
  });

  it('does not flag trades or adjustments as missing account/category', () => {
    const r = detectAnomalies([
      tx({ id: 1, type: 'trade', category_id: null }),
      tx({ id: 2, type: 'adjustment', category_id: null, account_id: null }),
    ]);
    expect(r.no_account).toHaveLength(0);
    expect(r.no_category).toHaveLength(0);
  });
});
