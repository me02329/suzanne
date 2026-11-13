import { describe, expect, it } from 'vitest';
import { compareWithBenchmark, priceOnOrBefore } from './benchmark.js';

const history = [
  { date: '2023-01-02', price: 100 },
  { date: '2023-06-01', price: 110 },
  { date: '2024-01-02', price: 120 },
  { date: '2024-06-03', price: 132 },
];

describe('priceOnOrBefore', () => {
  it('prend le dernier cours connu', () => {
    expect(priceOnOrBefore(history, '2023-01-01')).toBeNull();
    expect(priceOnOrBefore(history, '2023-01-02')).toBe(100);
    expect(priceOnOrBefore(history, '2023-12-31')).toBe(110);
    expect(priceOnOrBefore(history, '2030-01-01')).toBe(132);
  });
});

describe('compareWithBenchmark', () => {
  it('achète l’indice à chaque versement', () => {
    const r = compareWithBenchmark({
      flows: [{ date: '2023-01-02', amount: 1000 }, { date: '2024-01-02', amount: 1200 }],
      history,
      values: [{ date: '2023-01-06', value: 1000 }, { date: '2024-06-07', value: 2500 }],
      currentValue: 2500,
      asOf: '2024-06-07',
    })!;
    expect(r.start).toBe('2023-01-02');
    expect(r.absorbedFlows).toBe(0);
    expect(r.capital).toBe(2200);
    expect(r.units).toBeCloseTo(10 + 10, 10);
    expect(r.benchmark.value).toBeCloseTo(20 * 132, 6);
    expect(r.portfolio.gain).toBe(300);
    expect(r.benchmark.xirr).not.toBeNull();
  });

  it('même capital des deux côtés quand des versements précèdent l’historique', () => {
    const r = compareWithBenchmark({
      flows: [
        { date: '2022-03-01', amount: 5000 }, // avant l'historique de l'indice
        { date: '2023-06-01', amount: 1100 },
      ],
      history,
      values: [
        { date: '2022-12-30', value: 4800 },
        { date: '2023-01-06', value: 5200 },
        { date: '2024-06-07', value: 7000 },
      ],
      currentValue: 7000,
      asOf: '2024-06-07',
    })!;
    // Départ commun : 1re valorisation dès que l'indice cote (2023-01-06 → cours 100).
    expect(r.start).toBe('2023-01-06');
    expect(r.startValue).toBe(5200);
    expect(r.absorbedFlows).toBe(1);
    expect(r.capital).toBe(6300);
    expect(r.units).toBeCloseTo(52 + 10, 10);
    expect(r.portfolio.gain).toBe(700); // 7000 − 6300, pas 7000 − 6100
    expect(r.benchmark.gain).toBeCloseTo(62 * 132 - 6300, 6);
    expect(r.series[0]).toMatchObject({ date: '2023-01-06', portfolio: 5200, benchmark: 5200, contributed: 5200 });
  });

  it('retraits = ventes de parts', () => {
    const r = compareWithBenchmark({
      flows: [{ date: '2023-01-02', amount: 1000 }, { date: '2024-01-02', amount: -600 }],
      history,
      values: [],
      currentValue: 500,
      asOf: '2024-06-03',
    })!;
    expect(r.units).toBeCloseTo(10 - 5, 10);
    expect(r.capital).toBe(400);
  });

  it('null sans historique', () => {
    expect(compareWithBenchmark({ flows: [{ date: '2023-01-02', amount: 1 }], history: [], values: [], currentValue: 1, asOf: '2024-01-01' })).toBeNull();
  });
});
