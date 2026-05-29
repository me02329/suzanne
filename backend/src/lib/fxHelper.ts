import { fetchExchangeRate, normalizeCurrency, peekExchangeRate } from './fx.js';

// Build a currency -> rate-to-reportCurrency map covering EUR, the report
// currency, and the union of currencies actually present on the user's
// accounts. Used by dashboard and statistics aggregations.
//
// A provider outage must not take down the dashboard: if a rate can't be
// fetched we fall back to the last-known (stale) rate, and only as a last
// resort to 1 — a degraded total beats a 500 on the app's main page.
export interface FxResult {
  rates: Map<string, number>;
  // Currencies whose rate could not be refreshed (we used a stale or 1 fallback).
  // The UI surfaces these so the user knows totals may be off.
  degraded: string[];
}

export async function buildFx(accounts: Array<{ currency: string }>, reportCurrency: string): Promise<FxResult> {
  const currencies = Array.from(new Set(['EUR', reportCurrency, ...accounts.map((account) => normalizeCurrency(account.currency))]));
  const degraded: string[] = [];
  const entries = await Promise.all(currencies.map(async (currency) => {
    if (currency === reportCurrency) return [currency, 1] as const;
    try {
      const quote = await fetchExchangeRate(currency, reportCurrency);
      return [currency, quote.rate] as const;
    } catch (e) {
      const stale = peekExchangeRate(currency, reportCurrency);
      console.error('[fx] rate unavailable, falling back', { currency, reportCurrency, stale, detail: (e as Error).message });
      degraded.push(currency);
      return [currency, stale ?? 1] as const;
    }
  }));
  return { rates: new Map(entries), degraded };
}
