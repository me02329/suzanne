import { describe, expect, it } from 'vitest';
import { buildSearchTransactionsWhere } from './tools';

describe('buildSearchTransactionsWhere', () => {
  it('filters uncategorized non-transfer transactions when used alone', () => {
    const where = buildSearchTransactionsWhere(7, { uncategorized: true }, null);
    expect(where).toEqual({
      user_id: 7,
      category_id: null,
      type: { not: 'transfer' },
    });
  });

  it('keeps an explicit type filter when combined with uncategorized', () => {
    const where = buildSearchTransactionsWhere(7, { type: 'expense', uncategorized: true }, null);
    // type must stay 'expense' — uncategorized only forces category_id: null.
    expect(where).toEqual({
      user_id: 7,
      type: 'expense',
      category_id: null,
    });
  });

  it('passes through type, tag and date range', () => {
    const range = { gte: new Date('2026-05-01T00:00:00.000Z'), lt: new Date('2026-06-01T00:00:00.000Z') };
    const where = buildSearchTransactionsWhere(7, { type: 'income', tag_id: 3 }, range);
    expect(where).toEqual({
      user_id: 7,
      type: 'income',
      tags: { some: { tag_id: 3 } },
      date: range,
    });
  });
});
