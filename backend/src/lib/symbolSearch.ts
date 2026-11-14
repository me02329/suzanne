// Recherche de titres (autocomplétion à l'ajout d'une position) via l'API
// publique de Yahoo Finance, et fiche rapide d'un symbole (devise, dernier
// cours, nom). Résultats mis en cache quelques minutes : la saisie déclenche
// une requête par frappe (débouncée côté client).

const FETCH_TIMEOUT_MS = 6000;
const TTL_MS = 10 * 60_000;
const UA = { 'User-Agent': 'Mozilla/5.0 (suzanne)' };

export interface SymbolHit {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
}

export interface SymbolQuote {
  symbol: string;
  name: string | null;
  currency: string | null;
  price: number | null;
  exchange: string | null;
  type: string | null;
}

const cache = new Map<string, { at: number; value: unknown }>();
function cached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  return undefined;
}
function store(key: string, value: unknown) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

async function yahooSearch(query: string): Promise<SymbolHit[]> {
  const q = query.trim();
  if (!q) return [];
  const key = `s:${q.toLowerCase()}`;
  const hit = cached<SymbolHit[]>(key);
  if (hit) return hit;
  const url = new URL('https://query2.finance.yahoo.com/v1/finance/search');
  url.searchParams.set('q', q);
  url.searchParams.set('quotesCount', '12');
  url.searchParams.set('newsCount', '0');
  url.searchParams.set('listsCount', '0');
  url.searchParams.set('lang', 'fr-FR');
  url.searchParams.set('region', 'FR');
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json() as { quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; exchDisp?: string; exchange?: string; quoteTypeDisp?: string; quoteType?: string }> };
  const out: SymbolHit[] = (data.quotes ?? [])
    .filter((x) => typeof x.symbol === 'string' && x.symbol.length > 0)
    .map((x) => ({
      symbol: x.symbol!,
      name: x.longname ?? x.shortname ?? x.symbol!,
      exchange: x.exchDisp ?? x.exchange ?? null,
      type: x.quoteTypeDisp ?? x.quoteType ?? null,
    }));
  store(key, out);
  return out;
}

// Yahoo gère mal certaines requêtes à plusieurs mots (« nasdaq pea » → rien,
// « amundi pea » → ok). Sans résultat, on interroge chaque mot et on garde
// les titres dont le nom/ticker contient le plus de mots de la requête.
export async function searchSymbols(query: string): Promise<SymbolHit[]> {
  const direct = await yahooSearch(query);
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  if (direct.length > 0 || words.length < 2) return direct;
  const lists = await Promise.all(words.slice(0, 4).map((w) => yahooSearch(w).catch(() => [] as SymbolHit[])));
  const bySymbol = new Map<string, SymbolHit>();
  for (const list of lists) for (const h of list) if (!bySymbol.has(h.symbol)) bySymbol.set(h.symbol, h);
  const score = (h: SymbolHit) => {
    const text = `${h.symbol} ${h.name}`.toLowerCase();
    return words.filter((w) => text.includes(w)).length;
  };
  return Array.from(bySymbol.values())
    .map((h) => ({ h, s: score(h) }))
    .filter((x) => x.s >= Math.min(2, words.length))
    .sort((a, b) => b.s - a.s)
    .slice(0, 12)
    .map((x) => x.h);
}

export async function quoteSymbol(symbol: string): Promise<SymbolQuote> {
  const key = `q:${symbol}`;
  const hit = cached<SymbolQuote>(key);
  if (hit) return hit;
  const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', '5d');
  url.searchParams.set('interval', '1d');
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json() as { chart?: { result?: Array<{ meta?: { currency?: string; regularMarketPrice?: number; longName?: string; shortName?: string; fullExchangeName?: string; instrumentType?: string } }> } };
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) throw new Error('Symbole inconnu');
  const out: SymbolQuote = {
    symbol,
    name: meta.longName ?? meta.shortName ?? null,
    currency: meta.currency ?? null,
    price: typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null,
    exchange: meta.fullExchangeName ?? null,
    type: meta.instrumentType ?? null,
  };
  store(key, out);
  return out;
}
