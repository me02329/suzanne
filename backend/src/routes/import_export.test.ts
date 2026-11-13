import { describe, expect, it } from 'vitest';
import { parseSignedAmount } from './import_export';

describe('parseSignedAmount', () => {
  it.each([
    ['-12,50', -12.5],
    ['12.5', 12.5],
    ['1 234,56', 1234.56],
    ['1 234,56 €', 1234.56],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['-1.234.567', -1234567],
    ['(12,50)', -12.5],
    ['12,50-', -12.5],
    ['+3', 3],
  ])('%s → %d', (input, expected) => {
    expect(parseSignedAmount(input)).toBe(expected);
  });

  it.each(['', 'abc', '12,5x', undefined])('rejette %s', (input) => {
    expect(parseSignedAmount(input)).toBeNull();
  });
});
