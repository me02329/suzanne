import { describe, expect, it } from 'vitest';
import { buildRoadmap } from './roadmap';

describe('buildRoadmap', () => {
  it('coche les étapes atteintes et désigne la prochaine', () => {
    const r = buildRoadmap({
      accounts: [
        { type: 'checking' },
        { type: 'livret_a' },
        { type: 'life_insurance' },
        { type: 'pea', positions: [{ name: 'ETF Monde', asset_class: 'etf' }] },
      ],
      emergencyMonths: 1.2,
      uncategorizedShare: 0.05,
      investingMonths: 3,
    });
    const status = Object.fromEntries(r.steps.map((s) => [s.id, s.status]));
    expect(status).toEqual({ budget: 'done', emergency: 'partial', life_insurance: 'done', pea_etf: 'done', regular: 'done', property: 'optional', tax: 'optional' });
    expect(r.next).toBe('emergency');
    expect(r.done).toBe(4);
    expect(r.total).toBe(5);
    expect(r.steps.find((s) => s.id === 'emergency')!.progress).toBeCloseTo(0.4);
  });

  it('comptes pro ignorés ; SCPI = immobilier ; PEA sans ETF = partiel', () => {
    const r = buildRoadmap({
      accounts: [
        { type: 'life_insurance', professional: true },
        { type: 'pea', positions: [{ name: 'Action seule', asset_class: 'equity' }] },
        { type: 'securities', positions: [{ name: 'SCPI Rendement', asset_class: 'fund' }] },
      ],
      emergencyMonths: null,
      uncategorizedShare: null,
      investingMonths: 0,
    });
    const status = Object.fromEntries(r.steps.map((s) => [s.id, s.status]));
    expect(status.life_insurance).toBe('todo');
    expect(status.pea_etf).toBe('partial');
    expect(status.property).toBe('done');
    expect(r.next).toBe('budget');
  });
});
