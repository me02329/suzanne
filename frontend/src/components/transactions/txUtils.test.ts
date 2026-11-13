import { describe, expect, it } from 'vitest';
import type { Transaction } from '@suzanne/shared';
import { formatDayHeader, groupByDay, parseAmount, prefilledSplitDrafts } from './txUtils';

describe('parseAmount', () => {
  it('accepte la virgule française et les espaces', () => {
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('1 234,5')).toBe(1234.5);
    expect(parseAmount('12.50')).toBe(12.5);
    expect(parseAmount(' 8 € ')).toBe(8);
  });
  it('rejette les saisies invalides', () => {
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('1,2,3')).toBeNaN();
  });
});

describe('dates « YYYY-MM-DD »', () => {
  it('formate depuis les parties de la chaîne (pas de décalage de fuseau)', () => {
    expect(formatDayHeader('2026-03-01')).toMatch(/^Dimanche 1(er)? mars$/);
    expect(formatDayHeader('2026-03-01T00:00:00.000Z')).toMatch(/^Dimanche 1(er)? mars$/);
  });
  it('groupe par jour en conservant l\'ordre', () => {
    const tx = (id: number, date: string) => ({ id, date }) as Transaction;
    const groups = groupByDay([tx(1, '2026-03-12'), tx(2, '2026-03-12T10:00:00Z'), tx(3, '2026-03-10')]);
    expect(groups.map((g) => [g.day, g.rows.map((r) => r.id)])).toEqual([['2026-03-12', [1, 2]], ['2026-03-10', [3]]]);
  });
});

describe('prefilledSplitDrafts', () => {
  it('reprend catégorie et montant sur la 1re ligne, 2e vide', () => {
    const [a, b] = prefilledSplitDrafts(4, '80');
    expect(a).toMatchObject({ category_id: '4', amount: '80' });
    expect(b).toMatchObject({ category_id: '', amount: '' });
    expect(a!.key).not.toBe(b!.key);
  });
});
