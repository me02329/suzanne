import { describe, expect, it } from 'vitest';
import { numberOrNull } from './forms';

describe('form helpers', () => {
  it('returns positive numbers and null otherwise', () => {
    expect(numberOrNull('12')).toBe(12);
    expect(numberOrNull('0')).toBeNull();
    expect(numberOrNull('-1')).toBeNull();
    expect(numberOrNull('abc')).toBeNull();
    expect(numberOrNull(null)).toBeNull();
  });
});
