import { describe, expect, it } from 'vitest';
import { bucketByRule } from './categoryRules';

describe('bucketByRule', () => {
  const rules = [
    { pattern: 'CARREFOUR', category_id: 1 },
    { pattern: 'AMAZON', category_id: 2 },
    { pattern: 'SNCF', category_id: 3 },
  ];

  it('buckets transactions by the category of their first matching rule (case-insensitive)', () => {
    const result = bucketByRule([
      { id: 10, description: 'CARREFOUR MARKET PARIS' },
      { id: 11, description: 'Amazon EU' },
      { id: 12, description: 'AMAZON PRIME' },
      { id: 13, description: 'Loyer' },     // no match
      { id: 14, description: null },        // no description
    ], rules);
    expect(result.get(1)).toEqual([10]);
    expect(result.get(2)).toEqual([11, 12]);
    expect(result.get(3)).toBeUndefined();
    expect([...result.keys()].sort()).toEqual([1, 2]);
  });

  it('keeps the first matching rule when several patterns match', () => {
    const result = bucketByRule(
      [{ id: 1, description: 'CARREFOUR puis AMAZON' }],
      rules, // CARREFOUR is listed first
    );
    expect(result.get(1)).toEqual([1]);
    expect(result.get(2)).toBeUndefined();
  });
});
