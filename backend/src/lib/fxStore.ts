import { prisma } from '../prisma.js';
import { fetchExchangeRate, normalizeCurrency, peekExchangeRate } from './fx.js';

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
  return Promise.all(dates.map(async (date) => {
    const key = date.toISOString().slice(0, 10);
    const entries = await Promise.all(currencies.map(async (currency) =>
      [currency, await getRateAt(currency, reportCurrency, key)] as const,
    ));
    return new Map(entries);
  }));
}
