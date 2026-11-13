import { describe, expect, it } from 'vitest';
import { buildSearchTransactionsWhere, normalizeModelBooleans, parseModelBoolean } from './tools';

describe('buildSearchTransactionsWhere', () => {
  it('filters uncategorized income/expense (standard) transactions when used alone', () => {
    const where = buildSearchTransactionsWhere(7, { uncategorized: true }, null);
    expect(where).toEqual({
      user_id: 7,
      kind: 'standard',
      AND: [{ lines: { some: { category_id: null } } }],
    });
  });

  it('keeps an explicit type filter when combined with uncategorized', () => {
    const where = buildSearchTransactionsWhere(7, { type: 'transfer', uncategorized: true }, null);
    expect(where).toEqual({
      user_id: 7,
      kind: 'transfer',
      AND: [{ lines: { some: { category_id: null } } }],
    });
  });

  it('maps expense/income to standard kind (side filtered on the derived view)', () => {
    const range = { gte: new Date('2026-05-01T00:00:00.000Z'), lt: new Date('2026-06-01T00:00:00.000Z') };
    const where = buildSearchTransactionsWhere(7, { type: 'income', tag_id: 3, category_id: 9 }, range);
    expect(where).toEqual({
      user_id: 7,
      kind: 'standard',
      AND: [{ lines: { some: { category_id: 9 } } }],
      tags: { some: { tag_id: 3 } },
      date: range,
    });
  });
});

describe('model-provided booleans', () => {
  it('maps "false"/"0" strings to false (z.coerce.boolean would say true)', () => {
    expect(parseModelBoolean('false')).toBe(false);
    expect(parseModelBoolean('0')).toBe(false);
    expect(parseModelBoolean('true')).toBe(true);
    expect(parseModelBoolean(true)).toBe(true);
  });

  it('normalizes known boolean keys only', () => {
    expect(normalizeModelBooleans({ active: 'false', cleared: '1', description: 'false' }))
      .toEqual({ active: false, cleared: true, description: 'false' });
  });
});
