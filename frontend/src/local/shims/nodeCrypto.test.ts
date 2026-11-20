import { createHash as nodeCreateHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHash } from './nodeCrypto';

// Les empreintes d'import (import_fingerprint) doivent être identiques entre le
// serveur (node:crypto) et le mode local : sinon un même relevé ne serait plus
// reconnu, et une sauvegarde déplacée téléphone ⇄ serveur dupliquerait des lignes.
describe('node:crypto du mode local', () => {
  const samples = [
    '12|2026-11-20;CB CARREFOUR MARKET;-21,91',
    '-|Prélèvement « EDF » — échéance n°3 ; 1 234,56 €',
    '7|émojis 💶🏦 et accents àéèêëîïôöùûüç ÀÉ',
    '',
  ];
  it.each(samples)('sha256 hex identique à Node : %j', (raw) => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(nodeCreateHash('sha256').update(raw).digest('hex'));
  });
  it('mises à jour successives = concaténation, comme Node', () => {
    const local = createHash('sha256').update('a|').update('b').digest('hex');
    expect(local).toBe(nodeCreateHash('sha256').update('a|b').digest('hex'));
  });
});
