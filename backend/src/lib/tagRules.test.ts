import { describe, expect, it } from 'vitest';
import { tagsForDescription } from './tagRules';

describe('tagsForDescription', () => {
  const rules = [
    { pattern: 'SNCF', tag_id: 1 },
    { pattern: 'SEMINAIRE', tag_id: 1 },
    { pattern: 'SNCF', tag_id: 2 },
    { pattern: 'UBER', tag_id: 3 },
  ];
  it('pose tous les tags dont le motif figure dans le libellé, sans doublon', () => {
    expect(tagsForDescription(rules, 'Carte SNCF séminaire SEMINAIRE')).toEqual([1, 2]);
  });
  it('ignore la casse du libellé', () => {
    expect(tagsForDescription(rules, 'uber eats')).toEqual([3]);
  });
  it('ne pose rien sans libellé ni correspondance', () => {
    expect(tagsForDescription(rules, null)).toEqual([]);
    expect(tagsForDescription(rules, 'Boulangerie')).toEqual([]);
  });
});
