import { prisma } from '../prisma.js';
import { getQuoteAt } from './marketData.js';

// Historique de cours d'un symbole sur une période (benchmark, préchauffage du
// cache avant la valorisation hebdomadaire d'un PEA). Un seul appel Yahoo pour
// toute la période (au lieu d'un par jour via getQuoteAt), puis upsert dans
// market_data : chaque jour calendaire reçoit la dernière clôture connue
// (as_of = jour de cotation), comme le ferait getQuoteAt pour un week-end.
// Les lectures suivantes sont servies par la base.

const FETCH_TIMEOUT_MS = 8000;
const DAY_MS = 86_400_000;

// Plages déjà synchronisées (process) : évite de re-télécharger quand le symbole
// n'existait pas encore au début de la plage (jours jamais remplis).
const synced = new Map<string, Array<{ from: string; to: string }>>();

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

async function fetchYahooRange(symbol: string, from: string, to: string): Promise<{ closes: Array<{ date: string; price: number }>; currency: string | null }> {
  const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', '1d');
  // Une semaine de marge avant `from` : le premier jour reprend la clôture précédente.
  url.searchParams.set('period1', String(Math.floor((utcMs(from) - 7 * DAY_MS) / 1000)));
  url.searchParams.set('period2', String(Math.floor((utcMs(to) + DAY_MS) / 1000)));
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (suzanne)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json() as {
    chart?: {
      result?: Array<{
        meta?: { currency?: string };
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
      error?: { description?: string } | null;
    };
  };
  if (data.chart?.error) throw new Error(data.chart.error.description ?? 'Yahoo error');
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const byDay = new Map<string, number>();
  timestamps.forEach((ts, i) => {
    const close = closes[i];
    if (typeof close === 'number' && Number.isFinite(close) && close > 0) byDay.set(iso(ts * 1000), close);
  });
  return {
    closes: [...byDay.entries()].map(([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date)),
    currency: result?.meta?.currency ?? null,
  };
}

function isSynced(symbol: string, from: string, to: string): boolean {
  return (synced.get(symbol) ?? []).some((r) => r.from <= from && r.to >= to);
}

export interface HistoryPoint {
  date: string;
  price: number;
}

/**
 * Cours de clôture de `symbol` pour chaque jour coté entre `from` et `to`
 * (bornes incluses), + le cours du jour si `to` ≥ aujourd'hui. Lève si le
 * fournisseur est indisponible et que la base ne couvre pas la plage.
 */
export async function getPriceHistory(symbolRaw: string, from: string, to: string): Promise<HistoryPoint[]> {
  const symbol = symbolRaw.trim().toUpperCase();
  const today = iso(Date.now());
  const yesterday = iso(utcMs(today) - DAY_MS);
  const histTo = to < today ? to : yesterday;

  if (from <= histTo) {
    const expectedDays = Math.round((utcMs(histTo) - utcMs(from)) / DAY_MS) + 1;
    const stored = await prisma.marketData.count({
      where: { symbol, date: { gte: new Date(from), lte: new Date(histTo) } },
    });
    if (stored < expectedDays && !isSynced(symbol, from, histTo)) {
      const { closes, currency } = await fetchYahooRange(symbol, from, histTo);
      if (closes.length > 0) {
        const rows: Array<{ symbol: string; date: Date; price: number; currency: string | null; as_of: Date }> = [];
        let ci = 0;
        let last: { date: string; price: number } | null = null;
        for (let ms = utcMs(from); ms <= utcMs(histTo); ms += DAY_MS) {
          const day = iso(ms);
          while (ci < closes.length && closes[ci]!.date <= day) last = closes[ci++]!;
          if (!last) continue; // avant la première cotation : rien à stocker
          rows.push({ symbol, date: new Date(day), price: last.price, currency, as_of: new Date(last.date) });
        }
        // Lignes existantes conservées (un cours historique est immuable).
        await prisma.marketData.createMany({ data: rows, skipDuplicates: true });
      }
      const list = synced.get(symbol) ?? [];
      list.push({ from, to: histTo });
      synced.set(symbol, list);
    }
  }

  const rows = from <= histTo
    ? await prisma.marketData.findMany({
      where: { symbol, date: { gte: new Date(from), lte: new Date(histTo) } },
      orderBy: { date: 'asc' },
      select: { date: true, price: true, as_of: true },
    })
    : [];
  // Jours cotés seulement : les jours remplis (week-ends, fériés) ont un as_of antérieur.
  const points = rows
    .filter((r) => !r.as_of || r.as_of.getTime() === r.date.getTime())
    .map((r) => ({ date: r.date.toISOString().slice(0, 10), price: r.price }));

  if (to >= today) {
    const quote = await getQuoteAt(symbol, today);
    if (quote) points.push({ date: today, price: quote.price });
  }
  return points;
}
