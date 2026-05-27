import { fetchExchangeRate, normalizeCurrency } from './fx.js';

// Build a currency -> rate-to-reportCurrency map covering EUR, the report
// currency, and the union of currencies actually present on the user's
// accounts. Used by dashboard and statistics aggregations.
export async function buildFx(accounts: Array<{ currency: string }>, reportCurrency: string): Promise<Map<string, number>> {
  const currencies = Array.from(new Set(['EUR', reportCurrency, ...accounts.map((account) => normalizeCurrency(account.currency))]));
  const entries = await Promise.all(currencies.map(async (currency) => {
    if (currency === reportCurrency) return [currency, 1] as const;
    const quote = await fetchExchangeRate(currency, reportCurrency);
    return [currency, quote.rate] as const;
  }));
  return new Map(entries);
}
