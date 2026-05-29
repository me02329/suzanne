const CURRENCY_RX = /^[A-Z]{3}$/;

const aliases: Record<string, string> = {
  YEN: 'JPY',
};

interface CacheEntry {
  rate: number;
  asOf: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
// After a failed fetch, hold off retrying for a short while so a provider
// outage doesn't make every dashboard load re-hammer (and re-time-out) Yahoo.
const FAILURE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
const failures = new Map<string, number>();

export function normalizeCurrency(value: string): string {
  const code = value.trim().toUpperCase();
  const normalized = aliases[code] ?? code;
  if (!CURRENCY_RX.test(normalized)) throw new Error(`Invalid currency: ${value}`);
  return normalized;
}

function cacheKey(from: string, to: string, date?: string): string {
  return `${from}_${to}_${date ?? 'latest'}`;
}

// Best-effort last-known rate, ignoring expiry. Lets aggregations degrade to a
// stale rate during a provider outage instead of failing outright. Returns null
// if we have never successfully fetched this pair.
export function peekExchangeRate(fromRaw: string, toRaw: string, date?: string): number | null {
  const from = normalizeCurrency(fromRaw);
  const to = normalizeCurrency(toRaw);
  if (from === to) return 1;
  return cache.get(cacheKey(from, to, date))?.rate ?? null;
}

export async function fetchExchangeRate(fromRaw: string, toRaw: string, date?: string): Promise<{ from: string; to: string; rate: number; asOf: string | null }> {
  const from = normalizeCurrency(fromRaw);
  const to = normalizeCurrency(toRaw);
  if (from === to) return { from, to, rate: 1, asOf: new Date().toISOString().slice(0, 10) };

  const key = cacheKey(from, to, date);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { from, to, rate: cached.rate, asOf: cached.asOf };

  const failedAt = failures.get(key);
  if (failedAt && failedAt > Date.now()) throw new Error(`FX provider unavailable for ${from}->${to} (recent failure)`);

  try {
    const direct = await fetchYahooFx(`${from}${to}=X`, date).catch(() => null);
    const inverse = direct ? null : await fetchYahooFx(`${to}${from}=X`, date);
    const rate = direct ? direct.rate : 1 / inverse!.rate;
    const asOf = direct?.asOf ?? new Date().toISOString().slice(0, 10);
    cache.set(key, { rate, asOf, expiresAt: Date.now() + CACHE_TTL_MS });
    failures.delete(key);
    return { from, to, rate, asOf };
  } catch (e) {
    failures.set(key, Date.now() + FAILURE_TTL_MS);
    throw e;
  }
}

async function fetchYahooFx(symbol: string, date?: string): Promise<{ rate: number; asOf: string | null }> {
  const center = date ? Math.floor(new Date(`${date}T12:00:00.000Z`).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const period1 = center - 7 * 24 * 60 * 60;
  const period2 = date ? center + 3 * 24 * 60 * 60 : center;
  const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', '1d');
  url.searchParams.set('period1', String(period1));
  url.searchParams.set('period2', String(period2));

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (suzanne-lite)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Yahoo FX HTTP ${res.status}`);
  const data = await res.json() as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
      error?: { description?: string } | null;
    };
  };
  if (data.chart?.error) throw new Error(data.chart.error.description ?? 'Yahoo FX error');
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  for (let i = closes.length - 1; i >= 0; i -= 1) {
    const close = closes[i];
    if (typeof close === 'number' && Number.isFinite(close) && close > 0) {
      const ts = timestamps[i];
      return {
        rate: close,
        asOf: typeof ts === 'number' ? new Date(ts * 1000).toISOString().slice(0, 10) : null,
      };
    }
  }
  throw new Error(`No FX data for ${symbol}`);
}
