import { prisma } from '../prisma.js';
import { fetchExchangeRate, normalizeCurrency, peekExchangeRate } from './fx.js';
import { fetchYahooRange } from './priceHistory.js';

// Conversion FX *par date* pour le patrimoine historique. Un taux historique est
// immuable une fois le marché clôturé : on le mémorise dans la table
// exchange_rates (cache persistant) au lieu de ré-interroger Yahoo à chaque
// chargement de wealth-history. Le taux du jour, lui, bouge encore → il passe
// par le chemin mémoire de fx.ts et n'est jamais persisté.
//
// Comme buildFx, une panne du fournisseur ne doit pas faire tomber la page :
// on dégrade vers le dernier taux connu, puis vers 1 en dernier recours.

const todayKey = (): string => new Date().toISOString().slice(0, 10);

export async function getRateAt(fromRaw: string, toRaw: string, dateKey: string): Promise<number> {
  const from = normalizeCurrency(fromRaw);
  const to = normalizeCurrency(toRaw);
  if (from === to) return 1;

  // Aujourd'hui (ou futur) : taux courant, non persisté.
  if (dateKey >= todayKey()) {
    try {
      return (await fetchExchangeRate(from, to)).rate;
    } catch {
      return peekExchangeRate(from, to) ?? 1;
    }
  }

  const date = new Date(dateKey);
  const stored = await prisma.exchangeRate.findUnique({
    where: { base_quote_date: { base: from, quote: to, date } },
  });
  if (stored) return stored.rate;

  try {
    const quote = await fetchExchangeRate(from, to, dateKey);
    // upsert : deux chargements concurrents ne doivent pas se marcher dessus.
    await prisma.exchangeRate.upsert({
      where: { base_quote_date: { base: from, quote: to, date } },
      create: { base: from, quote: to, date, rate: quote.rate, as_of: quote.asOf ? new Date(quote.asOf) : null },
      update: {},
    });
    return quote.rate;
  } catch {
    return peekExchangeRate(from, to, dateKey) ?? peekExchangeRate(from, to) ?? 1;
  }
}

// Une carte devise -> taux-vers-reportCurrency par date demandée, alignée sur
// `dates`. Les devises sont résolues une fois (union EUR + report + comptes) ;
// chaque (devise, date) tape d'abord le cache DB. Le premier chargement peuple
// la table, les suivants sont servis depuis Postgres.
export async function buildFxByDate(
  accounts: Array<{ currency: string }>,
  reportCurrencyRaw: string,
  dates: Date[],
): Promise<Map<string, number>[]> {
  const reportCurrency = normalizeCurrency(reportCurrencyRaw);
  const currencies = Array.from(
    new Set(['EUR', reportCurrency, ...accounts.map((a) => normalizeCurrency(a.currency))]),
  );
  await prefetchRates(currencies.filter((c) => c !== reportCurrency), reportCurrency, dates);
  return Promise.all(dates.map(async (date) => {
    const key = date.toISOString().slice(0, 10);
    const entries = await Promise.all(currencies.map(async (currency) =>
      [currency, await getRateAt(currency, reportCurrency, key)] as const,
    ));
    return new Map(entries);
  }));
}

// Préchargement : pour chaque paire, les dates passées absentes du cache sont
// remplies en UN appel Yahoo couvrant toute la période (paire directe, sinon
// inverse), au lieu d'un appel par date (plusieurs secondes sur un historique
// hebdomadaire de plusieurs années). Chaque date reçoit la dernière clôture
// connue à ce jour. Échec silencieux : getRateAt prend le relais date par date.
async function prefetchRates(currencies: string[], reportCurrency: string, dates: Date[]): Promise<void> {
  const keys = Array.from(new Set(dates.map((d) => d.toISOString().slice(0, 10)).filter((k) => k < todayKey()))).sort();
  if (keys.length < 4) return;
  await Promise.all(currencies.map(async (from) => {
    const existing = await prisma.exchangeRate.findMany({
      where: { base: from, quote: reportCurrency, date: { in: keys.map((k) => new Date(k)) } },
      select: { date: true },
    });
    const have = new Set(existing.map((r) => r.date.toISOString().slice(0, 10)));
    const missing = keys.filter((k) => !have.has(k));
    if (missing.length < 4) return;
    const first = missing[0]!; const last = missing[missing.length - 1]!;
    let closes: Array<{ date: string; price: number }> = [];
    try {
      closes = (await fetchYahooRange(`${from}${reportCurrency}=X`, first, last)).closes;
    } catch { /* paire directe absente : on tente l'inverse */ }
    if (closes.length === 0) {
      try {
        closes = (await fetchYahooRange(`${reportCurrency}${from}=X`, first, last)).closes
          .filter((c) => c.price > 0).map((c) => ({ date: c.date, price: 1 / c.price }));
      } catch { return; }
    }
    if (closes.length === 0) return;
    const rows: Array<{ base: string; quote: string; date: Date; rate: number; as_of: Date }> = [];
    let ci = 0;
    let prev: { date: string; price: number } | null = null;
    for (const key of missing) {
      while (ci < closes.length && closes[ci]!.date <= key) prev = closes[ci++]!;
      if (prev) rows.push({ base: from, quote: reportCurrency, date: new Date(key), rate: prev.price, as_of: new Date(prev.date) });
    }
    if (rows.length > 0) await prisma.exchangeRate.createMany({ data: rows, skipDuplicates: true });
  }));
}
