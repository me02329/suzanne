import { describe, expect, it } from 'vitest';
import { CATEGORY_ICONS, categoryIcon, suggestCategoryIcon } from './categoryIcons';

describe('icônes de catégorie', () => {
  it('garde les noms déjà stockés en base et les alias', () => {
    for (const key of ['home', 'plus-circle', 'circle-ellipsis', 'shopping-cart', 'paw-print', 'trees']) expect(CATEGORY_ICONS[key]).toBeDefined();
    expect(categoryIcon('tools')).toBe(CATEGORY_ICONS.wrench);
    expect(categoryIcon('House')).toBe(CATEGORY_ICONS.home);
  });

  it('suggère une icône d’après le nom', () => {
    expect(suggestCategoryIcon('Boulangerie')).toBe('croissant');
    expect(suggestCategoryIcon('Courses')).toBe('shopping-cart');
    expect(suggestCategoryIcon('Frais bancaires')).toBe('landmark');
    expect(suggestCategoryIcon('Loyer')).toBe('home');
    expect(suggestCategoryIcon('Vétérinaire')).toBe('paw-print');
    expect(suggestCategoryIcon('Électricité')).toBe('zap');
    expect(suggestCategoryIcon('Autre revenu')).toBe('plus-circle');
    expect(suggestCategoryIcon('Restaurants')).toBe('utensils');
    expect(suggestCategoryIcon('Xyzzy')).toBeNull();
  });
});
