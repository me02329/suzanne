import { prisma } from '../prisma.js';
import { fetchYahooClose } from './fx.js';

// Cours des titres, jumeau de fxStore. Un cours historique est immuable une fois
// le marché clôturé : on le mémorise dans market_data (cache persistant) pour
// valoriser le patrimoine dans le temps sans ré-interroger Yahoo. Le cours du
// jour bouge encore → cache mémoire court (comme fx.ts), jamais persisté.
//
// Une panne du fournisseur ne doit pas faire tomber la page : on renvoie null
// et l'appelant dégrade (position non valorisée) au lieu de lever.

export interface Quote {
  price: number;
  currency: string | null;
}

const todayKey = (): string => new Date().toISOString().slice(0, 10);

const LATEST_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const latestCache = new Map<string, { quote: Quote; expiresAt: number }>();
const failures = new Map<string, number>();

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

async function latestQuote(symbol: string): Promise<Quote | null> {
  const cached = latestCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;
  const failedAt = failures.get(symbol);
  if (failedAt && failedAt > Date.now()) return cached?.quote ?? null;
  try {
    const close = await fetchYahooClose(symbol);
    const quote: Quote = { price: close.price, currency: close.currency };
    latestCache.set(symbol, { quote, expiresAt: Date.now() + LATEST_TTL_MS });
    failures.delete(symbol);
    return quote;
  } catch {
    failures.set(symbol, Date.now() + FAILURE_TTL_MS);
    return cached?.quote ?? null; // dégrade vers le dernier cours connu si on en a un
  }
}

export async function getQuoteAt(symbolRaw: string, dateKey: string): Promise<Quote | null> {
  const symbol = normalizeSymbol(symbolRaw);

  // Aujourd'hui (ou futur) : cours courant, non persisté.
  if (dateKey >= todayKey()) return latestQuote(symbol);

  const date = new Date(dateKey);
  const stored = await prisma.marketData.findUnique({ where: { symbol_date: { symbol, date } } });
  if (stored) return { price: stored.price, currency: stored.currency };

  try {
    const close = await fetchYahooClose(symbol, dateKey);
    await prisma.marketData.upsert({
      where: { symbol_date: { symbol, date } },
      create: { symbol, date, price: close.price, currency: close.currency, as_of: close.asOf ? new Date(close.asOf) : null },
      update: {},
    });
    return { price: close.price, currency: close.currency };
  } catch {
    return null;
  }
}

// Cours courant d'un lot de symboles (pour les vues « maintenant » : positions,
// allocation). Résolus en parallèle ; un symbole indisponible renvoie null.
export async function getLatestQuotes(symbolsRaw: string[]): Promise<Map<string, Quote | null>> {
  const symbols = Array.from(new Set(symbolsRaw.map(normalizeSymbol)));
  const entries = await Promise.all(symbols.map(async (s) => [s, await latestQuote(s)] as const));
  return new Map(entries);
}
