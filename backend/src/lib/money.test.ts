import { describe, expect, it } from 'vitest';
import { round2 } from './money';

describe('round2', () => {
  it('rounds common floating point imprecision to cents', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(10.005)).toBe(10.01);
  });

  it('preserves negative monetary values', () => {
    expect(round2(-12.345)).toBe(-12.34);
  });
});
