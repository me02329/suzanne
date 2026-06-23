import { FormEvent, useEffect, useState } from 'react';
import { CandlestickChart, ChevronDown, ChevronUp, Coins, Layers, Loader2, Pencil, Plus, TrendingUp, Wallet } from 'lucide-react';
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
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';
import { Collapsible } from '../components/Collapsible';
import type { Run } from '../lib/run';

const ASSET_CLASSES: ReadonlyArray<{ value: AssetClass; label: string }> = [
  { value: 'equity', label: 'Action' },
  { value: 'etf', label: 'ETF' },
  { value: 'fund', label: 'Fonds' },
  { value: 'bond', label: 'Obligation' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'commodity', label: 'Matière première' },
  { value: 'cash', label: 'Liquidités' },
  { value: 'other', label: 'Autre' },
];
const ASSET_LABEL = new Map(ASSET_CLASSES.map((a) => [a.value, a.label]));
const ALLOCATION_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#f59e0b', '#16a34a', '#db2777', '#64748b', '#9333ea'];

// Comptes pertinents pour des titres : groupes investissements / crypto en
// priorité, mais on n'empêche pas d'en attacher ailleurs.
function investmentAccounts(accounts: Account[], keepId?: number | null): Account[] {
  const pickable = pickableAccounts(accounts, keepId);
  const invest = pickable.filter((a) => ['investments', 'crypto'].includes(accountTypeGroup(a.type)));
  return invest.length > 0 ? invest : pickable;
}

const signedMoney = (value: number, currency: string) => `${value >= 0 ? '+' : '-'}${money(Math.abs(value), currency)}`;

export function Investments({ userId, holdings, accounts, accountById, reportCurrency, dataVersion, run }: {
  userId: number;
  holdings: Holding[];
  accounts: Account[];
  accountById: Map<number, Account>;
  reportCurrency: string;
  dataVersion: number;
  run: Run;
}) {
  const [valuation, setValuation] = useState<HoldingsValuation | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Holding | null>(null);
  const [ordersFor, setOrdersFor] = useState<Holding | null>(null);
  const [addOpen, setAddOpen] = usePersistedState<boolean>('investments_add_open', holdings.length === 0);

  // Valorisation au cours du jour : non couverte par le reload global (elle tape
  // les prix de marché en direct), donc rechargée sur dataVersion + devise.
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

  const submitAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createHolding(userId, {
      account_id: Number(data.get('account_id')),
      symbol: String(data.get('symbol')),
      name: String(data.get('name')),
      asset_class: String(data.get('asset_class')) as AssetClass,
      currency: String(data.get('currency') || 'EUR'),
    }), 'Position ajoutée');
    event.currentTarget.reset();
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.updateHolding(userId, editing.id, {
      symbol: String(data.get('symbol')),
      name: String(data.get('name')),
      asset_class: String(data.get('asset_class')) as AssetClass,
      currency: String(data.get('currency') || 'EUR'),
    }), 'Position modifiée');
    setEditing(null);
  };

  const total = valuation?.market_value ?? 0;

  return (
    <section className="stack">
      <div className="stats">
        <Stat icon={<Wallet />} label="Valeur de marché" value={money(total, reportCurrency)} />
        <Stat icon={<Coins />} label="Prix de revient" value={money(valuation?.cost_basis ?? 0, reportCurrency)} />
        <Stat
          icon={<TrendingUp />}
          label="Plus-value latente"
          value={signedMoney(valuation?.unrealized_pnl ?? 0, reportCurrency)}
          signed={valuation?.unrealized_pnl ?? 0}
        />
        <Stat
          icon={<TrendingUp />}
          label="Performance latente"
          value={`${(valuation?.unrealized_pnl_pct ?? 0) >= 0 ? '+' : ''}${(valuation?.unrealized_pnl_pct ?? 0).toFixed(2)} %`}
          signed={valuation?.unrealized_pnl_pct ?? 0}
        />
      </div>

      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouvelle position</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={addOpen} className="collapsible-body">
          <p className="panel-note">
            Le <strong>symbole</strong> est le ticker interrogé pour le cours (ex. <code>AAPL</code>, <code>CW8.PA</code>, <code>BTC-EUR</code>).
            La <strong>devise</strong> doit correspondre à la devise de cotation du titre. La quantité détenue et le prix de revient se déduisent du carnet d'ordres.
          </p>
          <form className="form form-inline" onSubmit={submitAdd}>
            <label>Compte
              <select name="account_id" required>
                {investmentAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label>Symbole<input name="symbol" placeholder="CW8.PA" required /></label>
            <label className="grow">Nom<input name="name" placeholder="Amundi MSCI World" required /></label>
            <label>Classe
              <select name="asset_class" defaultValue="etf">
                {ASSET_CLASSES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </label>
            <label>Devise<input name="currency" defaultValue="EUR" maxLength={3} style={{ width: '5rem' }} /></label>
            <button className="primary"><Plus size={16} /> Ajouter</button>
          </form>
        </Collapsible>
      </div>

      <Panel title="Positions" icon={<CandlestickChart />}>
        {loading && holdings.length > 0 && <p className="panel-note"><Loader2 className="spin-icon" size={14} /> Valorisation au cours du jour…</p>}
        <DataTable scroll empty={holdings.length === 0 ? 'Aucune position. Ajoute une position puis ses ordres d\'achat/vente.' : null}>
          <thead><tr>
            <th>Symbole</th><th>Compte</th><th className="amount-cell">Quantité</th><th className="amount-cell">PRU</th>
            <th className="amount-cell">Cours</th><th className="amount-cell">Valeur</th><th className="amount-cell">+/- value</th>
            <th className="amount-cell">Poids</th><th className="actions-cell">Actions</th>
          </tr></thead>
          <tbody>
            {holdings.map((h) => {
              const v = valById.get(h.id);
              const account = accountById.get(h.account_id);
              return (
                <tr key={h.id}>
                  <td data-label="Symbole">
                    <strong>{h.symbol}</strong>
                    <span className="muted" style={{ display: 'block', fontSize: '0.8em' }}>{h.name} · {ASSET_LABEL.get(h.asset_class)}</span>
                  </td>
                  <td data-label="Compte">{account?.name ?? <span className="muted">—</span>}</td>
                  <td className="amount-cell" data-label="Quantité">{v ? v.quantity : <span className="muted">0</span>}</td>
                  <td className="amount-cell" data-label="PRU">{v ? money(v.avg_cost, h.currency) : '—'}</td>
                  <td className="amount-cell" data-label="Cours">{v?.price != null ? money(v.price, h.currency) : <span className="muted">n/d</span>}</td>
                  <td className="amount-cell" data-label="Valeur">{v ? money(v.market_value, reportCurrency) : '—'}</td>
                  <td className={`amount-cell ${v && v.unrealized_pnl >= 0 ? 'income' : v ? 'expense' : ''}`} data-label="+/- value">
                    {v ? signedMoney(v.unrealized_pnl, reportCurrency) : '—'}
                  </td>
                  <td className="amount-cell" data-label="Poids">{v ? `${v.weight.toFixed(1)} %` : '—'}</td>
                  <td className="actions-cell">
                    <IconButton label="Ordres" tone="accent" icon={<Layers size={16} />} onClick={() => setOrdersFor(h)} />
                    <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(h)} />
                    <IconButton label="Supprimer" confirm={`Supprimer la position ${h.symbol} et tous ses ordres ?`} onClick={() => void run(() => api.deleteHolding(userId, h.id), 'Position supprimée')} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>

      {valuation && valuation.allocation.length > 0 && (
        <Panel title="Allocation par classe d'actif" icon={<Layers />}>
          <div className="alloc-bar">
            {valuation.allocation.map((slice, i) => (
              <span key={slice.asset_class} title={`${ASSET_LABEL.get(slice.asset_class)} · ${slice.weight}%`}
                style={{ width: `${slice.weight}%`, background: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }} />
            ))}
          </div>
          <DataTable empty={null}>
            <thead><tr><th>Classe</th><th className="amount-cell">Valeur</th><th className="amount-cell">Poids</th></tr></thead>
            <tbody>
              {valuation.allocation.map((slice, i) => (
                <tr key={slice.asset_class}>
                  <td><span className="dot inline" style={{ background: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }} /> {ASSET_LABEL.get(slice.asset_class)}</td>
                  <td className="amount-cell">{money(slice.value, reportCurrency)}</td>
                  <td className="amount-cell">{slice.weight.toFixed(1)} %</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {editing && (
        <Modal title={`Modifier ${editing.symbol}`} onClose={() => setEditing(null)}>
          <form className="form" onSubmit={submitEdit}>
            <label>Symbole<input name="symbol" defaultValue={editing.symbol} required /></label>
            <label>Nom<input name="name" defaultValue={editing.name} required /></label>
            <label>Classe
              <select name="asset_class" defaultValue={editing.asset_class}>
                {ASSET_CLASSES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </label>
            <label>Devise<input name="currency" defaultValue={editing.currency} maxLength={3} /></label>
            <button className="primary">Enregistrer</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>Annuler</button>
          </form>
        </Modal>
      )}

      {ordersFor && (
        <OrdersModal
          userId={userId}
          holding={holdings.find((h) => h.id === ordersFor.id) ?? ordersFor}
          run={run}
          onClose={() => setOrdersFor(null)}
        />
      )}
    </section>
  );
}

// Carnet d'ordres d'une position. La liste vient du prop `holdings` (rechargé
// par le reload global après chaque mutation via `run`).
function OrdersModal({ userId, holding, run, onClose }: {
  userId: number;
  holding: Holding;
  run: Run;
  onClose: () => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => api.addHoldingOrder(userId, holding.id, {
      side: String(data.get('side')) as 'buy' | 'sell',
      date: String(data.get('date')),
      quantity: Number(data.get('quantity')),
      unit_price: Number(data.get('unit_price')),
      fee: Number(data.get('fee') || 0),
    }), 'Ordre ajouté').then((ok) => { if (ok) form.reset(); });
  };

  return (
    <Modal title={`Ordres · ${holding.symbol}`} onClose={onClose} wide>
      <form className="form form-inline" onSubmit={submit}>
        <label>Sens
          <select name="side" defaultValue="buy">
            <option value="buy">Achat</option>
            <option value="sell">Vente</option>
          </select>
        </label>
        <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
        <label>Quantité<input name="quantity" type="number" min="0.00000001" step="any" required /></label>
        <label>Prix unitaire<input name="unit_price" type="number" min="0" step="any" required /></label>
        <label>Frais<input name="fee" type="number" min="0" step="0.01" defaultValue="0" /></label>
        <button className="primary"><Plus size={16} /> Ajouter l'ordre</button>
      </form>
      <DataTable scroll empty={holding.orders.length === 0 ? 'Aucun ordre.' : null}>
        <thead><tr><th>Date</th><th>Sens</th><th className="amount-cell">Quantité</th><th className="amount-cell">Prix</th><th className="amount-cell">Frais</th><th className="actions-cell">Actions</th></tr></thead>
        <tbody>
          {[...holding.orders].sort((a, b) => b.date.localeCompare(a.date)).map((o) => (
            <tr key={o.id}>
              <td data-label="Date">{new Date(o.date).toLocaleDateString('fr-FR')}</td>
              <td data-label="Sens"><span className={o.side === 'buy' ? 'income' : 'expense'}>{o.side === 'buy' ? 'Achat' : 'Vente'}</span></td>
              <td className="amount-cell" data-label="Quantité">{o.quantity}</td>
              <td className="amount-cell" data-label="Prix">{money(o.unit_price, holding.currency)}</td>
              <td className="amount-cell" data-label="Frais">{o.fee ? money(o.fee, holding.currency) : '—'}</td>
              <td className="actions-cell">
                <IconButton label="Supprimer l'ordre" confirm="Supprimer cet ordre ?" onClick={() => void run(() => api.deleteHoldingOrder(userId, holding.id, o.id), 'Ordre supprimé')} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <button type="button" className="secondary" onClick={onClose}>Fermer</button>
    </Modal>
  );
}
