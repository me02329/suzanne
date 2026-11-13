// Suivi hebdomadaire et versements mensuels d'une enveloppe. Porté depuis njord
// (lib/portfolio.ts buildTracking/getFridaysList, components/PaymentsChart.tsx) :
// njord avançait les vendredis avec Date#setDate en heure locale ; ici tout est
// en arithmétique UTC sur des dates ISO.

import type { FlowValuePoint } from './twr.js';

export interface DatedAmount {
  date: string;
  amount: number;
}

const DAY_MS = 86_400_000;

function utcMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Premier vendredi ≥ date (la date elle-même si c'est un vendredi). */
export function fridayOnOrAfter(date: string): string {
  const ms = utcMs(date);
  const dow = new Date(ms).getUTCDay(); // 0 = dimanche, 5 = vendredi
  return iso(ms + ((5 - dow + 7) % 7) * DAY_MS);
}

/** Vendredis entre deux dates (bornes incluses). */
export function fridaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = utcMs(to);
  for (let ms = utcMs(fridayOnOrAfter(from)); ms <= end; ms += 7 * DAY_MS) out.push(iso(ms));
  return out;
}

export interface TrackingRow {
  date: string;
  value: number;
  /** Versements nets cumulés jusqu'à cette date incluse. */
  cumulatedDeposits: number;
  /** Versements nets de la période (depuis la ligne précédente). */
  flow: number;
  /** Plus/moins-value : valeur − versements nets cumulés. */
  gain: number;
  /** En %, null si rien n'a été versé. */
  gainPct: number | null;
  /** Variation de marché de la période (hors versements), null pour la 1re ligne. */
  change: number | null;
  changePct: number | null;
}

/**
 * Tableau de suivi : une ligne par point de valorisation. La variation d'une
 * semaine exclut les versements de la semaine (sinon un versement passe pour
 * un gain).
 */
export function buildTracking(values: ReadonlyArray<{ date: string; value: number }>, flows: ReadonlyArray<DatedAmount>): TrackingRow[] {
  const points = [...values].sort((a, b) => a.date.localeCompare(b.date));
  const sortedFlows = [...flows].map((f) => ({ date: f.date.slice(0, 10), amount: f.amount })).sort((a, b) => a.date.localeCompare(b.date));
  const rows: TrackingRow[] = [];
  let fi = 0;
  let cumulated = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    let flow = 0;
    while (fi < sortedFlows.length && sortedFlows[fi]!.date <= p.date) {
      flow += sortedFlows[fi]!.amount;
      fi += 1;
    }
    cumulated += flow;
    const prev = rows[i - 1];
    const change = prev ? p.value - prev.value - flow : null;
    const base = prev ? prev.value + flow : 0;
    rows.push({
      date: p.date,
      value: p.value,
      cumulatedDeposits: round2(cumulated),
      flow: round2(flow),
      gain: round2(p.value - cumulated),
      gainPct: cumulated > 0 ? ((p.value - cumulated) / cumulated) * 100 : null,
      change: change == null ? null : round2(change),
      changePct: change != null && base > 0.005 ? (change / base) * 100 : null,
    });
  }
  return rows;
}

/** Points (valeur, flux de la période) pour l'indice TWR. */
export function trackingToFlowPoints(rows: ReadonlyArray<TrackingRow>): FlowValuePoint[] {
  return rows.map((r) => ({ date: r.date, value: r.value, flow: r.flow }));
}

export interface MonthlyFlow {
  /** YYYY-MM */
  month: string;
  deposits: number;
  withdrawals: number;
  net: number;
  /** Versements nets cumulés à fin de mois. */
  cumulative: number;
}

/** Versements par mois (mois sans versement inclus, jusqu'à `until` si fourni). */
export function monthlyFlows(flows: ReadonlyArray<DatedAmount>, until?: string): MonthlyFlow[] {
  if (flows.length === 0) return [];
  const byMonth = new Map<string, { deposits: number; withdrawals: number }>();
  for (const f of flows) {
    const key = f.date.slice(0, 7);
    const row = byMonth.get(key) ?? { deposits: 0, withdrawals: 0 };
    if (f.amount >= 0) row.deposits += f.amount;
    else row.withdrawals -= f.amount;
    byMonth.set(key, row);
  }
  const keys = [...byMonth.keys()].sort();
  const last = until && until.slice(0, 7) > keys[keys.length - 1]! ? until.slice(0, 7) : keys[keys.length - 1]!;
  let [y, m] = keys[0]!.split('-').map(Number) as [number, number];
  const out: MonthlyFlow[] = [];
  let cumulative = 0;
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > last) break;
    const row = byMonth.get(key) ?? { deposits: 0, withdrawals: 0 };
    const net = row.deposits - row.withdrawals;
    cumulative += net;
    out.push({ month: key, deposits: round2(row.deposits), withdrawals: round2(row.withdrawals), net: round2(net), cumulative: round2(cumulative) });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
