import { describe, expect, it } from 'vitest';
import { normalizeCurrency, peekExchangeRate } from './fx';

describe('normalizeCurrency', () => {
  it('uppercases and resolves aliases', () => {
    expect(normalizeCurrency('eur')).toBe('EUR');
    expect(normalizeCurrency('yen')).toBe('JPY');
  });

  it('rejects malformed codes', () => {
    expect(() => normalizeCurrency('euro')).toThrow();
    expect(() => normalizeCurrency('$$')).toThrow();
  });
});

describe('peekExchangeRate', () => {
  it('returns 1 for an identical pair', () => {
    expect(peekExchangeRate('USD', 'USD')).toBe(1);
  });

  it('returns null when no rate has ever been cached', () => {
    expect(peekExchangeRate('USD', 'EUR')).toBeNull();
  });
});
