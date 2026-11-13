import { fetchExchangeRate, normalizeCurrency, peekExchangeRate } from './fx.js';
import { getRateAt } from './fxStore.js';
import { getLatestQuotes, getQuoteAt } from './marketData.js';
import { getPriceHistory } from './priceHistory.js';
import { positionStats, valuePosition, type OrderLike, type PositionValue } from './holdings.js';

// Valorisation des positions = colle entre la logique pure (holdings.ts), le
// provider de cours (marketData.ts) et le FX (fx/fxStore). Le cours d'un titre
// est exprimé dans la devise du titre (`holding.currency`, à renseigner pour
// qu'elle corresponde à la cotation), convertie ensuite vers la devise du compte
// puis vers la devise de reporting — exactement comme les soldes de comptes.

export interface HoldingInput {
  id: number;
  account_id: number;
  symbol: string;
  name: string;
  asset_class: string;
  currency: string;
  orders: OrderLike[];
}
interface AccountCcy { id: number; currency: string }

// Résout des taux courants à la demande avec mémo local (en plus du cache de
// fx.ts) : dégrade vers le dernier taux connu, puis 1, comme buildFx.
function latestRateResolver() {
  const memo = new Map<string, Promise<number>>();
  return (fromRaw: string, toRaw: string): Promise<number> => {
    const from = normalizeCurrency(fromRaw);
    const to = normalizeCurrency(toRaw);
    if (from === to) return Promise.resolve(1);
    const key = `${from}_${to}`;
    let p = memo.get(key);
    if (!p) {
      p = fetchExchangeRate(from, to)
        .then((q) => q.rate)
        .catch(() => peekExchangeRate(from, to) ?? 1);
      memo.set(key, p);
    }
    return p;
  };
}

export interface HoldingValuation extends PositionValue {
  id: number;
  account_id: number;
  symbol: string;
  name: string;
  asset_class: string;
  currency: string;
  price: number | null;          // cours unitaire (devise du titre), null si indispo
  market_value_report: number;   // valeur de marché convertie en devise de reporting
  cost_basis_report: number;
  unrealized_pnl_report: number;
}

// Valorisation détaillée par position, en devise de reporting (page Patrimoine /
// allocation). Ne renvoie que les positions encore détenues (quantité > 0).
export async function valueHoldings(holdings: HoldingInput[], reportCurrencyRaw: string): Promise<HoldingValuation[]> {
  const reportCurrency = normalizeCurrency(reportCurrencyRaw);
  const quotes = await getLatestQuotes(holdings.map((h) => h.symbol));
  const rate = latestRateResolver();

  const out: HoldingValuation[] = [];
  for (const h of holdings) {
    const stats = positionStats(h.orders);
    if (stats.quantity <= 0) continue;
    const price = quotes.get(h.symbol.trim().toUpperCase())?.price ?? null;
    const valued = valuePosition(stats, price);
    const fx = await rate(h.currency, reportCurrency);
    out.push({
      ...valued,
      id: h.id,
      account_id: h.account_id,
      symbol: h.symbol,
      name: h.name,
      asset_class: h.asset_class,
      currency: h.currency,
      price,
      market_value_report: valued.market_value * fx,
      cost_basis_report: valued.cost_basis * fx,
      unrealized_pnl_report: valued.unrealized_pnl * fx,
    });
  }
  return out;
}

// Valeur de marché des titres par compte, en devise du compte, à maintenant.
// S'ajoute au solde cash dans computeAccountBalances.
export async function securitiesByAccountNow(holdings: HoldingInput[], accounts: AccountCcy[]): Promise<Map<number, number>> {
  const ccyByAccount = new Map(accounts.map((a) => [a.id, a.currency]));
  const quotes = await getLatestQuotes(holdings.map((h) => h.symbol));
  const rate = latestRateResolver();

  const result = new Map<number, number>();
  for (const h of holdings) {
    const accountCcy = ccyByAccount.get(h.account_id);
    if (!accountCcy) continue;
    const stats = positionStats(h.orders);
    if (stats.quantity <= 0) continue;
    const price = quotes.get(h.symbol.trim().toUpperCase())?.price ?? null;
    const valueHoldingCcy = valuePosition(stats, price).market_value;
    const fx = await rate(h.currency, accountCcy);
    result.set(h.account_id, (result.get(h.account_id) ?? 0) + valueHoldingCcy * fx);
  }
  return result;
}

// Valeur de marché des titres par compte et par date (devise du compte), alignée
// sur `dates`. Alimente computeWealthSeries pour un patrimoine historique qui
// inclut les titres valorisés au cours de chaque date.
export async function securitiesByAccountByDate(
  holdings: HoldingInput[],
  accounts: AccountCcy[],
  dates: Date[],
): Promise<Map<number, number[]>> {
  const ccyByAccount = new Map(accounts.map((a) => [a.id, a.currency]));
  const result = new Map<number, number[]>();
  if (holdings.length === 0) return result;

  // Préchauffe le cache de cours en UN appel Yahoo par titre pour toute la
  // période (au lieu d'un appel par date manquante : ~8 s au premier affichage
  // d'un historique hebdomadaire de plusieurs années).
  const past = dates.filter((d) => d.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10));
  if (past.length > 0) {
    const from = past[0]!.toISOString().slice(0, 10);
    const to = past[past.length - 1]!.toISOString().slice(0, 10);
    const symbols = Array.from(new Set(holdings.filter((h) => h.orders.length > 0).map((h) => h.symbol)));
    await Promise.all(symbols.map((symbol) => getPriceHistory(symbol, from, to).catch(() => null)));
  }

  await Promise.all(dates.map(async (date, di) => {
    const key = date.toISOString().slice(0, 10);
    for (const h of holdings) {
      const accountCcy = ccyByAccount.get(h.account_id);
      if (!accountCcy) continue;
      const stats = positionStats(h.orders, date);
      if (stats.quantity <= 0) continue;
      const quote = await getQuoteAt(h.symbol, key);
      const valueHoldingCcy = valuePosition(stats, quote?.price ?? null).market_value;
      const fx = await getRateAt(h.currency, accountCcy, key);
      let series = result.get(h.account_id);
      if (!series) { series = new Array(dates.length).fill(0); result.set(h.account_id, series); }
      series[di]! += valueHoldingCcy * fx;
    }
  }));
  return result;
}
