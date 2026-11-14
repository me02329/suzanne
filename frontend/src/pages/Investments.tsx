import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChartLine, Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  accountTypeGroup,
  type Account,
  type AssetClass,
  type Holding,
  type HoldingsValuation,
  type ValuedHolding,
} from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { money, todayIso } from '../lib/format';
import { formatDateFr, formatPct, formatQuantity, parseDecimal } from '../lib/pea';
import { Modal } from '../components/Modal';
import { SymbolSearch, assetClassFromYahoo } from '../components/SymbolSearch';
import { RowMenu } from '../components/accounts/RowMenu';
import type { Run } from '../lib/run';
import '../styles/pages/accounts.css';
import '../styles/pages/pea.css';
import '../styles/pages/investments.css';

// Classes d'actif : clés de catalogue (libellés traduits à l'affichage).
const ASSET_CLASSES: ReadonlyArray<{ value: AssetClass; label: string }> = [
  { value: 'equity', label: 'patrimoine.investments.asset_equity' },
  { value: 'etf', label: 'patrimoine.investments.asset_etf' },
  { value: 'fund', label: 'patrimoine.investments.asset_fund' },
  { value: 'bond', label: 'patrimoine.investments.asset_bond' },
  { value: 'crypto', label: 'patrimoine.investments.asset_crypto' },
  { value: 'commodity', label: 'patrimoine.investments.asset_commodity' },
  { value: 'cash', label: 'patrimoine.investments.asset_cash' },
  { value: 'other', label: 'patrimoine.investments.asset_other' },
];
const ASSET_LABEL = new Map(ASSET_CLASSES.map((a) => [a.value, a.label]));
// Nuances d'encre (pas de couleur décorative) pour la barre d'allocation.
const ALLOC_SHADES = [1, 0.72, 0.5, 0.34, 0.22, 0.14, 0.09, 0.05];

function investmentAccounts(accounts: Account[], keepId?: number | null): Account[] {
  const pickable = pickableAccounts(accounts, keepId);
  const invest = pickable.filter((a) => ['investments', 'crypto'].includes(accountTypeGroup(a.type)));
  return invest.length > 0 ? invest : pickable;
}

const signed = (v: number, ccy: string) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v), ccy)}`;

export function Investments({ userId, holdings, accounts, accountById, reportCurrency, dataVersion, run }: {
  userId: number;
  holdings: Holding[];
  accounts: Account[];
  accountById: Map<number, Account>;
  reportCurrency: string;
  dataVersion: number;
  run: Run;
}) {
  const { t } = useTranslation();
  const assetLabel = (c: AssetClass) => t(ASSET_LABEL.get(c) ?? 'patrimoine.investments.asset_other');
  const [valuation, setValuation] = useState<HoldingsValuation | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Holding | 'new' | null>(null);
  const [ordersFor, setOrdersFor] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.holdingsValuation(userId, reportCurrency)
      .then((v) => { if (!cancelled) setValuation(v); })
      .catch(() => { if (!cancelled) setValuation(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, reportCurrency, dataVersion]);

  const valById = new Map<number, ValuedHolding>((valuation?.holdings ?? []).map((h) => [h.id, h]));
  const total = valuation?.market_value ?? 0;
  const pnl = valuation?.unrealized_pnl ?? 0;
  const missingQuotes = (valuation?.holdings ?? []).some((h) => h.quantity > 0 && h.price == null);

  const removeHolding = (h: Holding) => void run(() => api.deleteHolding(userId, h.id), t('patrimoine.investments.holding_deleted', { symbol: h.symbol }), {
    undo: async () => {
      const created = await api.createHolding(userId, { account_id: h.account_id, symbol: h.symbol, name: h.name, asset_class: h.asset_class, currency: h.currency });
      for (const o of [...h.orders].sort((a, b) => a.date.localeCompare(b.date))) {
        await api.addHoldingOrder(userId, created.id, { side: o.side, date: o.date, quantity: o.quantity, unit_price: o.unit_price, fee: o.fee });
      }
    },
  });

  // Groupé par compte, triées par valeur décroissante.
  const byAccount = new Map<number, Holding[]>();
  for (const h of holdings) byAccount.set(h.account_id, [...(byAccount.get(h.account_id) ?? []), h]);
  const groups = Array.from(byAccount.entries())
    .map(([id, list]) => ({
      account: accountById.get(id),
      id,
      list: list.sort((a, b) => (valById.get(b.id)?.market_value ?? 0) - (valById.get(a.id)?.market_value ?? 0)),
      value: list.reduce((s, h) => s + (valById.get(h.id)?.market_value ?? 0), 0),
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <section className="pg-stack">
      <header className="acc-hero">
        <div className="acc-hero-main">
          <span className="acc-kicker">{t('patrimoine.investments.total_value')}</span>
          <strong className="acc-hero-value num">{money(total, reportCurrency)}</strong>
          <span className="acc-hero-sub">
            <span>{t('patrimoine.investments.cost_basis')} <b className="num">{money(valuation?.cost_basis ?? 0, reportCurrency)}</b></span>
            <span>{t('patrimoine.investments.unrealized')} <b className={`num ${pnl >= 0 ? 'income' : 'expense'}`}>{signed(pnl, reportCurrency)} ({formatPct(valuation?.unrealized_pnl_pct ?? 0)})</b></span>
          </span>
        </div>
        <div className="acc-hero-actions">
          <button type="button" className="primary accent" onClick={() => setForm('new')}><Plus size={16} /> {t('patrimoine.investments.add_holding')}</button>
        </div>
      </header>

      {loading && holdings.length > 0 && <p className="acc-muted"><Loader2 className="spin-icon" size={14} /> {t('patrimoine.investments.valuing')}</p>}
      {!loading && missingQuotes && <p className="pea-note">{t('patrimoine.investments.some_prices_missing')}</p>}

      {holdings.length === 0 ? (
        <div className="acc-empty">
          <p>{t('patrimoine.investments.no_holding')}</p>
          <p className="acc-muted">{t('patrimoine.investments.no_holding_hint')}</p>
        </div>
      ) : groups.map((g) => (
        <section className="pg-section" key={g.id}>
          <div className="pg-section-head">
            <h2>{g.account ? <Link className="inv-acc-link" to={`/accounts/${g.id}`}>{g.account.name}</Link> : t('patrimoine.investments.unknown_account')}</h2>
            <span className="inv-head-side">
              <span className="num acc-muted">{money(g.value, reportCurrency)}</span>
              {g.account && (
                <Link className="secondary inv-analysis" to={`/accounts/${g.id}`} title={t('patrimoine.investments.analysis_hint')}>
                  <ChartLine size={15} /> {g.account.type === 'pea' ? t('patrimoine.investments.pea_analysis') : t('patrimoine.investments.analysis')}
                </Link>
              )}
            </span>
          </div>
          <div className="pea-table-wrap">
            <table className="pea-table inv-table">
              <thead><tr>
                <th>{t('patrimoine.investments.col_security')}</th><th className="r">{t('patrimoine.investments.col_quantity')}</th><th className="r">{t('patrimoine.investments.col_avg_cost')}</th><th className="r">{t('patrimoine.investments.col_price')}</th>
                <th className="r">{t('patrimoine.investments.col_value')}</th><th className="r">{t('patrimoine.investments.col_unrealized')}</th><th className="r">{t('patrimoine.investments.col_weight')}</th><th aria-label={t('patrimoine.investments.col_actions')} />
              </tr></thead>
              <tbody>
                {g.list.map((h) => {
                  const v = valById.get(h.id);
                  // Quantité exacte depuis le carnet (la valorisation l'arrondit à 2 décimales).
                  const qty = h.orders.reduce((sum, o) => sum + (o.side === 'buy' ? o.quantity : -o.quantity), 0);
                  const pct = v && v.cost_basis > 0 ? (v.unrealized_pnl / v.cost_basis) * 100 : null;
                  return (
                    <tr key={h.id}>
                      <td className="pea-title"><strong>{h.name || h.symbol}</strong><span>{h.symbol} · {assetLabel(h.asset_class)}</span></td>
                      <td className="r num" data-label={t('patrimoine.investments.col_quantity')}>{formatQuantity(Math.round(qty * 1e8) / 1e8)}</td>
                      <td className="r num" data-label={t('patrimoine.investments.col_avg_cost')}>{v ? money(v.avg_cost, h.currency) : '—'}</td>
                      <td className="r num" data-label={t('patrimoine.investments.col_price')}>{v?.price != null ? money(v.price, h.currency) : <span className="acc-muted">{t('patrimoine.investments.not_available')}</span>}</td>
                      <td className="r num pea-value" data-label={t('patrimoine.investments.col_value')}>{v ? money(v.market_value, reportCurrency) : '—'}</td>
                      <td className={`r num ${v && v.price != null ? (v.unrealized_pnl >= 0 ? 'income' : 'expense') : ''}`} data-label={t('patrimoine.investments.col_unrealized')}>
                        {v && v.price != null ? <>{signed(v.unrealized_pnl, reportCurrency)} <small>{formatPct(pct)}</small></> : '—'}
                      </td>
                      <td className="r num" data-label={t('patrimoine.investments.col_weight')}>{v ? formatPct(v.weight, false) : '—'}</td>
                      <td className="inv-actions-cell"><div className="inv-actions">
                        <button type="button" className="secondary inv-orders-btn" onClick={() => setOrdersFor(h.id)}><Layers size={15} /> {t('patrimoine.investments.orders')} <span className="acc-count">{h.orders.length}</span></button>
                        <RowMenu label={t('patrimoine.investments.more_actions_for', { symbol: h.symbol })} items={[
                          { label: t('patrimoine.investments.edit'), icon: <Pencil size={16} />, onClick: () => setForm(h) },
                          { label: t('patrimoine.investments.delete'), icon: <Trash2 size={16} />, danger: true, onClick: () => removeHolding(h) },
                        ]} />
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {valuation && valuation.allocation.length > 0 && (
        <section className="pg-section">
          <div className="pg-section-head"><h2>{t('patrimoine.investments.allocation')}</h2></div>
          <div className="inv-alloc">
            <div className="inv-alloc-bar">
              {valuation.allocation.map((s, i) => (
                <span key={s.asset_class} title={`${assetLabel(s.asset_class)} · ${s.weight} %`} style={{ width: `${s.weight}%`, opacity: ALLOC_SHADES[i % ALLOC_SHADES.length] }} />
              ))}
            </div>
            <ul className="inv-alloc-list">
              {valuation.allocation.map((s, i) => (
                <li key={s.asset_class}>
                  <i style={{ opacity: ALLOC_SHADES[i % ALLOC_SHADES.length] }} />
                  <span>{assetLabel(s.asset_class)}</span>
                  <span className="num">{money(s.value, reportCurrency)}</span>
                  <span className="num acc-muted">{formatPct(s.weight, false)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {form && <HoldingModal userId={userId} holding={form === 'new' ? null : form} accounts={accounts} run={run} onClose={() => setForm(null)} />}
      {ordersFor != null && holdings.some((h) => h.id === ordersFor) && (
        <OrdersModal userId={userId} holding={holdings.find((h) => h.id === ordersFor)!} run={run} onClose={() => setOrdersFor(null)} />
      )}
    </section>
  );
}

function HoldingModal({ userId, holding, accounts, run, onClose }: { userId: number; holding: Holding | null; accounts: Account[]; run: Run; onClose: () => void }) {
  const { t } = useTranslation();
  const choices = investmentAccounts(accounts);
  // Par défaut : le PEA s'il y en a un (enveloppe la plus courante), sinon le 1er compte.
  const [accountId, setAccountId] = useState(String(holding?.account_id ?? (choices.find((a) => a.type === 'pea') ?? choices[0])?.id ?? ''));
  const [symbol, setSymbol] = useState(holding?.symbol ?? '');
  const [name, setName] = useState(holding?.name ?? '');
  const [currency, setCurrency] = useState(holding?.currency ?? 'EUR');
  const [assetClass, setAssetClass] = useState<AssetClass>(holding?.asset_class ?? 'etf');
  const [lastPrice, setLastPrice] = useState<{ price: number; currency: string } | null>(null);
  const isPea = accounts.find((a) => String(a.id) === accountId)?.type === 'pea';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = {
      symbol: symbol.trim().toUpperCase(),
      name: name.trim() || symbol.trim().toUpperCase(),
      asset_class: assetClass,
      currency: (currency || 'EUR').trim().toUpperCase(),
    };
    void run(
      () => (holding ? api.updateHolding(userId, holding.id, body) : api.createHolding(userId, { ...body, account_id: Number(accountId) })),
      holding ? t('patrimoine.investments.holding_updated') : t('patrimoine.investments.holding_added'),
    ).then((ok) => { if (ok) onClose(); });
  };
  return (
    <Modal title={holding ? t('patrimoine.investments.edit_symbol', { symbol: holding.symbol }) : t('patrimoine.investments.add_holding')} onClose={onClose}>
      <form className="form acc-form sheet-ok" onSubmit={submit}>
        {!holding && (
          <label className="full">{t('patrimoine.investments.account')}
            <select name="account_id" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {choices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label className="full">{t('patrimoine.investments.col_security')}
          <SymbolSearch
            value={symbol}
            pea={isPea}
            onChange={(v) => { setSymbol(v); setLastPrice(null); }}
            onPick={(hit, quote) => {
              setName(quote?.name ?? hit.name);
              if (quote?.currency) setCurrency(quote.currency.toUpperCase());
              setAssetClass(assetClassFromYahoo(quote?.type ?? hit.type));
              setLastPrice(quote?.price != null && quote.currency ? { price: quote.price, currency: quote.currency } : null);
            }}
          />
        </label>
        {lastPrice && <p className="acc-muted full">{t('patrimoine.investments.last_price', { price: money(lastPrice.price, lastPrice.currency) })}</p>}
        <label>{t('patrimoine.investments.currency')}<input name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} required /></label>
        <label>{t('patrimoine.investments.asset_class')}
          <select name="asset_class" value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)}>
            {ASSET_CLASSES.map((a) => <option key={a.value} value={a.value}>{t(a.label)}</option>)}
          </select>
        </label>
        <label className="full">{t('patrimoine.investments.name')}<input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Amundi MSCI World" required /></label>{/* i18n-ignore : exemple de nom de produit */}
        <p className="acc-muted full">{t('patrimoine.investments.search_hint')}</p>
        <div className="acc-form-actions full">
          <button type="button" className="secondary" onClick={onClose}>{t('patrimoine.investments.cancel')}</button>
          <button className="primary">{holding ? t('patrimoine.investments.save') : t('patrimoine.investments.add')}</button>
        </div>
      </form>
    </Modal>
  );
}

// Carnet d'ordres : quantités décimales (8 décimales), saisie à la virgule.
function OrdersModal({ userId, holding, run, onClose }: { userId: number; holding: Holding; run: Run; onClose: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const quantity = parseDecimal(data.get('quantity'), 8);
    const unit_price = parseDecimal(data.get('unit_price'), 6);
    const fee = parseDecimal(data.get('fee') || '0');
    if (!(quantity > 0)) { setError(t('patrimoine.investments.invalid_quantity')); return; }
    if (!(unit_price >= 0)) { setError(t('patrimoine.investments.invalid_unit_price')); return; }
    if (!(fee >= 0)) { setError(t('patrimoine.investments.invalid_fee')); return; }
    setError(null);
    void run(() => api.addHoldingOrder(userId, holding.id, {
      side: String(data.get('side')) as 'buy' | 'sell',
      date: String(data.get('date')),
      quantity, unit_price, fee,
    }), t('patrimoine.investments.order_added')).then((ok) => { if (ok) form.reset(); });
  };
  const orders = [...holding.orders].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return (
    <Modal title={t('patrimoine.investments.orders_of', { symbol: holding.symbol })} onClose={onClose} wide>
      <form className="form inv-order-form sheet-ok" onSubmit={submit}>
        <label>{t('patrimoine.investments.side')}
          <select name="side" defaultValue="buy"><option value="buy">{t('patrimoine.investments.buy')}</option><option value="sell">{t('patrimoine.investments.sell')}</option></select>
        </label>
        <label>{t('patrimoine.investments.date')}<input name="date" type="date" defaultValue={todayIso()} required /></label>
        <label>{t('patrimoine.investments.col_quantity')}<input name="quantity" inputMode="decimal" autoComplete="off" placeholder="0,12345678" required /></label>
        <label>{t('patrimoine.investments.unit_price', { ccy: holding.currency })}<input name="unit_price" inputMode="decimal" autoComplete="off" placeholder="0,00" required /></label>
        <label>{t('patrimoine.investments.fee')}<input name="fee" inputMode="decimal" autoComplete="off" defaultValue="0" /></label>
        <button className="primary"><Plus size={16} /> {t('patrimoine.investments.add_order')}</button>
        {error && <p className="acc-error full" role="alert">{error}</p>}
      </form>
      {orders.length === 0 ? <p className="acc-muted">{t('patrimoine.investments.no_order')}</p> : (
        <ul className="inv-orders">
          {orders.map((o) => (
            <li key={o.id}>
              <span className={`inv-side ${o.side}`}>{o.side === 'buy' ? t('patrimoine.investments.buy') : t('patrimoine.investments.sell')}</span>
              <div className="inv-order-main">
                <span className="num">{formatQuantity(o.quantity)} × {money(o.unit_price, holding.currency)}</span>
                <span className="acc-muted">{formatDateFr(o.date)}{o.fee ? ` · ${t('patrimoine.investments.fee_amount', { amount: money(o.fee, holding.currency) })}` : ''}</span>
              </div>
              <span className="num inv-order-total">{money(o.quantity * o.unit_price + (o.side === 'buy' ? o.fee : -o.fee), holding.currency)}</span>
              <button
                type="button"
                className="row-btn"
                aria-label={t('patrimoine.investments.delete_order')}
                title={t('patrimoine.investments.delete')}
                onClick={() => void run(() => api.deleteHoldingOrder(userId, holding.id, o.id), t('patrimoine.investments.order_deleted'), {
                  undo: () => api.addHoldingOrder(userId, holding.id, { side: o.side, date: o.date, quantity: o.quantity, unit_price: o.unit_price, fee: o.fee }),
                })}
              ><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
