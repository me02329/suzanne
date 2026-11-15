import { describe, expect, it } from 'vitest';
import { buildPyramid, type PyramidAccount } from './pyramid';

const base: PyramidAccount[] = [
  { id: 1, name: 'Courant', type: 'checking', institution: 'Banque A', balance: 1500 },
  { id: 2, name: 'Livret A', type: 'livret_a', institution: 'Banque A', balance: 4500 },
  {
    id: 3, name: 'PEA', type: 'pea', institution: 'Courtier', balance: 10_000,
    positions: [{ symbol: 'CW8', name: 'ETF Monde', asset_class: 'etf', value: 9_500 }],
  },
  {
    id: 4, name: 'Assurance-vie', type: 'life_insurance', institution: 'Assureur', balance: 8_000,
    positions: [{ symbol: 'UC', name: 'UC actions', asset_class: 'fund', value: 3_000 }],
  },
  { id: 5, name: 'Crypto', type: 'crypto', balance: 1_000, positions: [{ symbol: 'BTC', name: 'Bitcoin', asset_class: 'crypto', value: 1_000 }] },
  { id: 6, name: 'Société', type: 'checking', professional: true, balance: 5_000 },
  { id: 7, name: 'Prêt', type: 'loan', balance: -2_000 },
];

describe('buildPyramid', () => {
  it('range comptes et positions par étage et classe d\'actifs, hors société et dettes', () => {
    const r = buildPyramid(base, 2_000);
    const layer = (id: string) => r.layers.find((l) => l.layer === id)!;
    expect(layer('safety').amount).toBe(6_000);                // courant + livret
    expect(layer('secure').amount).toBe(500 + 5_000);          // espèces PEA + fonds euros
    expect(layer('growth').amount).toBe(9_500 + 3_000);        // ETF + UC
    expect(layer('speculative').amount).toBe(1_000);
    expect(r.total).toBe(25_000);
    expect(r.excluded).toEqual({ business: 5_000, debts: 2_000 });
    expect(r.buckets.find((b) => b.bucket === 'bonds')!.amount).toBe(5_000);
    expect(r.emergencyMonths).toBe(3);
    expect(r.diagnostics.map((d) => d.id)).toEqual(expect.arrayContaining(['emergency_ok', 'speculative_ok']));
    expect(r.diagnostics.map((d) => d.id)).not.toContain('open_pea');
  });

  it('signale une précaution insuffisante, trop de spéculatif et les garanties dépassées', () => {
    const r = buildPyramid([
      { id: 1, name: 'Courant', type: 'checking', institution: 'Banque A', balance: 1_000 },
      { id: 2, name: 'Livret', type: 'savings', institution: 'Banque A', balance: 120_000 },
      { id: 3, name: 'Crypto', type: 'crypto', balance: 30_000 },
      { id: 4, name: 'CTO', type: 'securities', balance: 20_000, positions: [{ symbol: 'X', name: 'Action X', asset_class: 'equity', value: 20_000 }] },
    ], 50_000);
    const ids = r.diagnostics.map((d) => d.id);
    expect(ids).toContain('emergency_low');
    expect(ids).toContain('speculative_high');
    expect(ids).toContain('concentration');
    expect(ids).toContain('guarantee_deposits');
    expect(ids).toContain('open_life_insurance');
  });

  it('sans dépenses connues : pas de nombre de mois', () => {
    const r = buildPyramid(base, null);
    expect(r.emergencyMonths).toBeNull();
    expect(r.diagnostics[0]!.id).toBe('emergency_missing');
  });
});
