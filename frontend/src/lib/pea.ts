import type { AccountSnapshot, Holding, HoldingsValuation, Transaction, ValuedHolding } from '@suzanne/shared';
import type { AccountWithInvestment } from './api-accounts';

// Versement (+) ou retrait (−) d'une enveloppe : ligne d'un virement (kind
// 'transfer') sur le compte. La ligne source peut manquer (versement importé
// depuis njord) — seule compte la ligne posée sur ce compte.
export interface EnvelopeFlow {
  id: number;
  date: string; // YYYY-MM-DD
  amount: number;
  description: string | null;
}

export function envelopeFlows(transactions: Transaction[], accountId: number): EnvelopeFlow[] {
  const flows: EnvelopeFlow[] = [];
  for (const tx of transactions) {
    if (tx.kind !== 'transfer') continue;
    const amount = tx.lines.filter((l) => l.account_id === accountId).reduce((s, l) => s + l.amount, 0);
    if (Math.abs(amount) < 0.005) continue;
    flows.push({ id: tx.id, date: tx.date.slice(0, 10), amount: Math.round(amount * 100) / 100, description: tx.description });
  }
  return flows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

/**
 * Espèces d'un compte d'investissement, en devise du compte.
 *
 * Même règle que le solde du dashboard (computeAccountBalances) mais SANS la
 * valeur des titres : ancre = dernier relevé (mouvements strictement après) ou
 * solde initial (mouvements du jour inclus), + somme des lignes du compte
 * (versements, retraits, mouvements `trade` des ordres, frais…). Les relevés
 * d'un compte d'investissement portent donc sur les espèces seules. On évite
 * « solde dashboard − titres » : deux appels aux cours (instants différents)
 * et une conversion en devise de reporting fausseraient la différence.
 */
export function accountCash(account: AccountWithInvestment, transactions: Transaction[], snapshots: AccountSnapshot[]): number {
  const own = snapshots.filter((s) => s.account_id === account.id);
  const latest = own.reduce<AccountSnapshot | null>((best, s) => (!best || s.date > best.date ? s : best), null);
  const anchor = latest ? latest.balance : account.initial_balance;
  const since = (latest ? latest.date : account.initial_balance_date).slice(0, 10);
  let cash = anchor;
  for (const tx of transactions) {
    const day = tx.date.slice(0, 10);
    if (latest ? day <= since : day < since) continue;
    for (const line of tx.lines) if (line.account_id === account.id) cash += line.amount;
  }
  return Math.round(cash * 100) / 100;
}

// Positions valorisées d'un compte. Si la valorisation a échoué (hors ligne),
// on reconstruit les positions au prix de revient depuis le carnet d'ordres.
export function positionsAtCost(holdings: Holding[], accountId: number): ValuedHolding[] {
  const rows: ValuedHolding[] = [];
  for (const h of holdings) {
    if (h.account_id !== accountId) continue;
    let quantity = 0;
    let cost = 0;
    let realized = 0;
    for (const o of [...h.orders].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
      if (o.side === 'buy') {
        quantity += o.quantity;
        cost += o.quantity * o.unit_price + o.fee;
      } else if (quantity > 0) {
        const unit = cost / quantity;
        const q = Math.min(o.quantity, quantity);
        realized += q * o.unit_price - o.fee - unit * q;
        cost -= unit * q;
        quantity -= q;
      }
    }
    if (quantity <= 1e-9) continue;
    rows.push({
      id: h.id, account_id: h.account_id, symbol: h.symbol, name: h.name, asset_class: h.asset_class, currency: h.currency,
      quantity, avg_cost: cost / quantity, price: null, market_value: cost, cost_basis: cost,
      unrealized_pnl: 0, realized_pnl: realized, weight: 0,
    });
  }
  const total = rows.reduce((s, r) => s + r.market_value, 0);
  for (const r of rows) r.weight = total > 0 ? (r.market_value / total) * 100 : 0;
  return rows;
}

export function accountPositions(valuation: HoldingsValuation, accountId: number): ValuedHolding[] {
  const rows = valuation.holdings.filter((h) => h.account_id === accountId && h.quantity > 0);
  const total = rows.reduce((s, r) => s + r.market_value, 0);
  // Poids recalculé au sein du compte (l'API le donne sur tout le portefeuille).
  return rows
    .map((r) => ({ ...r, weight: total > 0 ? (r.market_value / total) * 100 : 0 }))
    .sort((a, b) => b.market_value - a.market_value);
}

/**
 * Saisie décimale tolérante : virgule française, espaces (y compris insécables),
 * arrondi à `decimals` décimales. NaN si la saisie n'est pas un nombre.
 */
export function parseDecimal(raw: FormDataEntryValue | string | null | undefined, decimals = 2): number {
  const text = String(raw ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (text === '' || !/^-?\d*\.?\d*$/.test(text)) return Number.NaN;
  const n = Number(text);
  if (!Number.isFinite(n)) return Number.NaN;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// Affichage d'une quantité (jusqu'à 8 décimales, sans zéros inutiles).
export function formatQuantity(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 8 }).format(value);
}

export function formatPct(value: number | null, signed = true, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const text = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  const sign = value > 0 && signed ? '+' : value < 0 ? '−' : '';
  return `${sign}${text} %`;
}

export function formatDateFr(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d)));
}
