import { describe, expect, it } from 'vitest';
import { amountInputValue, parseAmount, positiveAmount } from './amount';

describe('parseAmount', () => {
  it('accepte la virgule, les espaces et €', () => {
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('1 234,5 €')).toBe(1234.5);
    expect(parseAmount('1 000')).toBe(1000);
    expect(parseAmount('-3.2')).toBe(-3.2);
  });
  it('rejette les saisies invalides', () => {
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('1,2,3')).toBeNaN();
    expect(positiveAmount('0')).toBeNull();
    expect(positiveAmount('-4')).toBeNull();
  });
  it('formate la valeur initiale avec une virgule', () => {
    expect(amountInputValue(12.5)).toBe('12,5');
    expect(amountInputValue(null)).toBe('');
  });
});
