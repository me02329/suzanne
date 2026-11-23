import { describe, expect, it } from 'vitest';
import { addButtonIndex, sanitizeTabbar, TABBAR_DEFAULT } from './tabbar';

describe('barre du bas', () => {
  it('garde un réglage valide, dans son ordre', () => {
    expect(sanitizeTabbar(['accounts', 'home'])).toEqual(['accounts', 'home']);
    expect(sanitizeTabbar(['analysis', 'ops', 'plan', 'home'])).toEqual(['analysis', 'ops', 'plan', 'home']);
  });
  it('retire inconnus et doublons, et revient au défaut hors des bornes 2–4', () => {
    expect(sanitizeTabbar(['home', 'home', 'inconnue', 'ops'])).toEqual(['home', 'ops']);
    expect(sanitizeTabbar(['home'])).toEqual([...TABBAR_DEFAULT]);
    expect(sanitizeTabbar(['home', 'ops', 'accounts', 'plan', 'analysis'])).toEqual([...TABBAR_DEFAULT]);
    expect(sanitizeTabbar('n’importe quoi')).toEqual([...TABBAR_DEFAULT]);
  });
  it('place le « + » au milieu des éléments', () => {
    expect(addButtonIndex(2)).toBe(2); // A B + Plus
    expect(addButtonIndex(3)).toBe(2); // A B + C Plus (barre actuelle)
    expect(addButtonIndex(4)).toBe(3); // A B C + D Plus
  });
});
