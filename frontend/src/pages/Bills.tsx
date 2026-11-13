import { FormEvent, useEffect, useState } from 'react';
import { Link2, Pencil, Plus, Power, Search, Trash2, X } from 'lucide-react';
import type { Account, Bill, BillStatusEntry, BillsStatusSummary, Category, CreateBillBody, Transaction } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { formatMonthLong, money } from '../lib/format';
import { numberOrNull } from '../lib/forms';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import { amountInputValue, positiveAmount } from '../components/home/amount';
import type { Run } from '../lib/run';
import '../styles/pages/plan.css';

// jj/mm/aaaa à partir d'une date ISO (sans passer par Date : pas de décalage de fuseau).
const dayLabel = (iso: string | null | undefined, withYear = false) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
};

function frequencyLabel(bill: Bill): string {
  const base = bill.frequency === 'yearly' ? 'an' : 'mois';
  return bill.interval > 1 ? `Tous les ${bill.interval} ${base}` : bill.frequency === 'yearly' ? 'Annuelle' : 'Mensuelle';
}

// Libellé + ton de l'étiquette de statut. `not_due` couvre aussi les factures
// inactives (le backend ne les déclare jamais dues).
function statusTag(entry: BillStatusEntry): { label: string; tone: string } {
  if (!entry.bill.active) return { label: 'Inactive', tone: 'tag' };
  switch (entry.status) {
    case 'paid': return { label: 'Payée', tone: 'tag ok' };
    case 'paid_out_of_range': return { label: 'Hors fourchette', tone: 'tag bad' };
    case 'late': return { label: 'En retard', tone: 'tag bad' };
    case 'pending': return { label: 'À venir', tone: 'tag ink' };
    case 'not_due': return { label: 'Pas ce mois', tone: 'tag' };
  }
}

const STATUS_ORDER: Record<string, number> = { late: 0, pending: 1, paid_out_of_range: 2, paid: 3, not_due: 4 };

export function Bills({ userId, month, billsStatus, accounts, categories, accountById, run }: {
  userId: number;
  month: string;
  billsStatus: BillsStatusSummary | null;
  accounts: Account[];
  categories: Category[];
  accountById: Map<number, Account>;
  run: Run;
}) {
  const [form, setForm] = useState<'new' | Bill | null>(null);
  const [linking, setLinking] = useState<BillStatusEntry | null>(null);
  const entries = [...(billsStatus?.bills ?? [])].sort((a, b) =>
    Number(!a.bill.active) - Number(!b.bill.active)
    || (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    || (a.expected_date ?? '').localeCompare(b.expected_date ?? ''));
  const currencyOf = (bill: Bill) => (bill.account_id != null ? accountById.get(bill.account_id)?.currency ?? 'EUR' : 'EUR');

  const remove = (entry: BillStatusEntry) => {
    const bill = entry.bill;
    const manual = entry.matched_transactions.some((t) => t.manual);
    // Recréer la facture rétablit le rapprochement automatique, pas les liens
    // manuels : dans ce cas, pas d'annulation (le menu demande confirmation).
    if (manual) {
      void run(() => api.deleteBill(userId, bill.id), 'Facture supprimée');
      return;
    }
    const body: CreateBillBody = {
      name: bill.name,
      amount_min: bill.amount_min,
      amount_max: bill.amount_max,
      start_date: bill.start_date.slice(0, 10),
      frequency: bill.frequency,
      interval: bill.interval,
      pattern: bill.pattern,
      account_id: bill.account_id,
      category_id: bill.category_id,
      active: bill.active,
    };
    void run(() => api.deleteBill(userId, bill.id), 'Facture supprimée', { undo: () => api.createBill(userId, body) });
  };

  const due = billsStatus?.due_count ?? 0;
  const paid = billsStatus?.paid_count ?? 0;
  const remaining = Math.max(0, (billsStatus?.expected_total ?? 0) - (billsStatus?.paid_total ?? 0));

  return (
    <section className="pg bills-page">
      <div className="pg-hero">
        <div>
          <span className="pg-kicker">Factures · {formatMonthLong(month)}</span>
          {due > 0 ? (
            <>
              <strong className="pg-hero-value">{paid} <small>/ {due} payée{due > 1 ? 's' : ''}</small></strong>
              <p className="pg-hero-sub">
                Payé <strong>{money(billsStatus?.paid_total ?? 0)}</strong> sur ~{money(billsStatus?.expected_total ?? 0)} attendus
                {remaining > 0 && <> · reste ~<strong>{money(remaining)}</strong></>}
              </p>
            </>
          ) : (
            <p className="pg-hero-sub">Aucune facture attendue ce mois-ci.</p>
          )}
        </div>
        <div className="pg-toolbar-actions">
          <button type="button" className="primary accent" onClick={() => setForm('new')}>
            <Plus size={16} /> Nouvelle facture
          </button>
        </div>
        {due > 0 && (
          <div className="pg-hero-meter">
            <div className="meter big"><span style={{ width: `${Math.min(100, (paid / due) * 100)}%` }} /></div>
          </div>
        )}
      </div>

      <div className="pg-card">
        <div className="pg-card-head"><h2>Échéancier</h2></div>
        {entries.length === 0 ? (
          <p className="pg-empty">
            <strong>Aucune facture attendue</strong>
            Ajoute tes charges variables (électricité, eau…) avec une fourchette : on vérifie chaque mois qu’elles sont payées.
          </p>
        ) : (
          <ul className="lrows">
            {entries.map((entry) => {
              const bill = entry.bill;
              const tag = statusTag(entry);
              const currency = currencyOf(bill);
              const muted = !bill.active || entry.status === 'not_due';
              return (
                <li key={bill.id} className={muted ? 'lrow muted' : 'lrow'}>
                  <div className="lrow-main">
                    <div className="lrow-title">
                      <span title={bill.name}>{bill.name}</span>
                      <span className={tag.tone}>{tag.label}</span>
                    </div>
                    <span className="lrow-sub">
                      {entry.expected_date ? `Le ${dayLabel(entry.expected_date)}` : frequencyLabel(bill)}
                      {' · '}{money(bill.amount_min, currency)} – {money(bill.amount_max, currency)}
                      {entry.expected_date && <> · {frequencyLabel(bill)}</>}
                    </span>
                  </div>
                  <div className="lrow-amount">
                    {entry.paid_amount > 0 ? (
                      <span title={entry.matched_transactions.map((t) => `${dayLabel(t.date, true)} · ${t.description ?? `#${t.id}`} · ${money(t.amount, currency)}`).join('\n')}>
                        {money(entry.paid_amount, currency)}
                      </span>
                    ) : <span className="muted">—</span>}
                    <small>{entry.matched_transactions.length > 1 ? `${entry.matched_transactions.length} paiements` : entry.paid_amount > 0 ? 'payé' : 'non payé'}</small>
                  </div>
                  <div className="lrow-actions">
                    {entry.due && (
                      <button type="button" className="icon-button neutral" title="Lier une dépense" aria-label={`Lier une dépense à ${bill.name}`} onClick={() => setLinking(entry)}>
                        <Link2 size={17} />
                      </button>
                    )}
                    <button type="button" className="icon-button neutral" title="Modifier" aria-label={`Modifier ${bill.name}`} onClick={() => setForm(bill)}>
                      <Pencil size={17} />
                    </button>
                    <RowMenu
                      items={[
                        {
                          label: bill.active ? 'Désactiver' : 'Réactiver',
                          icon: <Power />,
                          onSelect: () => void run(() => api.updateBill(userId, bill.id, { active: !bill.active }), bill.active ? 'Facture désactivée' : 'Facture réactivée'),
                        },
                        {
                          label: 'Supprimer', icon: <Trash2 />, danger: true, onSelect: () => remove(entry),
                          confirm: entry.matched_transactions.some((t) => t.manual) ? `Supprimer « ${bill.name} » ? Les dépenses liées manuellement seront déliées.` : undefined,
                        },
                      ]}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {form && (
        <BillFormModal
          userId={userId}
          month={month}
          editing={form === 'new' ? null : form}
          accounts={accounts}
          categories={categories}
          run={run}
          onClose={() => setForm(null)}
        />
      )}

      {linking && (
        <BillLinkModal
          userId={userId}
          entry={linking}
          accountById={accountById}
          run={run}
          onClose={() => setLinking(null)}
        />
      )}
    </section>
  );
}

function BillFormModal({ userId, month, editing, accounts, categories, run, onClose }: {
  userId: number;
  month: string;
  editing: Bill | null;
  accounts: Account[];
  categories: Category[];
  run: Run;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const expenseCategories = categories.filter((c) => c.type === 'expense');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const min = positiveAmount(data.get('amount_min'));
    const max = positiveAmount(data.get('amount_max'));
    if (min == null || max == null) { setError('Indique une fourchette de montants positifs.'); return; }
    if (max < min) { setError('Le montant max doit être supérieur ou égal au min.'); return; }
    const body = {
      name: String(data.get('name')).trim(),
      amount_min: min,
      amount_max: max,
      start_date: String(data.get('start_date')),
      frequency: String(data.get('frequency')) as Bill['frequency'],
      interval: Number(data.get('interval') || 1),
      pattern: String(data.get('pattern') || '').trim() || null,
      account_id: numberOrNull(data.get('account_id')),
      category_id: numberOrNull(data.get('category_id')),
    };
    const op = editing
      ? run(() => api.updateBill(userId, editing.id, body), 'Facture modifiée')
      : run(() => api.createBill(userId, body), 'Facture attendue ajoutée');
    void op.then((ok) => { if (ok) onClose(); });
  };

  return (
    <Modal title={editing ? `Modifier « ${editing.name} »` : 'Nouvelle facture attendue'} onClose={onClose}>
      <form className="pg-form" onSubmit={submit} onInput={() => setError(null)}>
        <label className="full">Nom<input name="name" defaultValue={editing?.name ?? ''} placeholder="ex. Électricité" required autoFocus /></label>
        <label>Montant min<input name="amount_min" inputMode="decimal" autoComplete="off" defaultValue={amountInputValue(editing?.amount_min)} required /></label>
        <label>Montant max<input name="amount_max" inputMode="decimal" autoComplete="off" defaultValue={amountInputValue(editing?.amount_max)} required /></label>
        <label>Première échéance<input name="start_date" type="date" defaultValue={editing?.start_date?.slice(0, 10) ?? `${month}-01`} required /></label>
        <label>Fréquence
          <select name="frequency" defaultValue={editing?.frequency ?? 'monthly'}>
            <option value="monthly">Mensuelle</option>
            <option value="yearly">Annuelle</option>
          </select>
        </label>
        <label>Intervalle<input name="interval" type="number" inputMode="numeric" min="1" max="24" defaultValue={editing?.interval ?? 1} /></label>
        <label>Motif de rapprochement<input name="pattern" defaultValue={editing?.pattern ?? ''} placeholder="vide = le nom" /></label>
        <label>Compte
          <select name="account_id" defaultValue={editing?.account_id ?? ''}>
            <option value="">Tous</option>
            {pickableAccounts(accounts, editing?.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>Catégorie
          <select name="category_id" defaultValue={editing?.category_id ?? ''}>
            <option value="">Toutes</option>
            {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <p className="hint full">Intervalle 3 = trimestrielle. Le paiement est repéré dans les dépenses dont le libellé contient le motif.</p>
        {error && <p className="hint full expense" role="alert">{error}</p>}
        <div className="pg-form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="primary">{editing ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Modal>
  );
}

// Rapprochement manuel : lie une dépense réelle à une facture quand le motif
// automatique ne la trouve pas (espèces, libellé bancaire variable). La
// dépense compte alors comme paiement sur le mois de sa date.
function BillLinkModal({ userId, entry, accountById, run, onClose }: {
  userId: number;
  entry: BillStatusEntry;
  accountById: Map<number, Account>;
  run: Run;
  onClose: () => void;
}) {
  const bill = entry.bill;
  const currency = bill.account_id != null ? accountById.get(bill.account_id)?.currency ?? 'EUR' : 'EUR';
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Transaction[]>([]);
  const [searching, setSearching] = useState(false);
  const manualMatches = entry.matched_transactions.filter((t) => t.manual);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api.findTransactions(userId, { type: 'expense', q: query.trim() || undefined, limit: 20 })
        .then((rows) => { if (!cancelled) setCandidates(rows); })
        .catch(() => { if (!cancelled) setCandidates([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId, query]);

  const link = (transactionId: number) => {
    void run(() => api.linkBillMatch(userId, bill.id, transactionId), 'Dépense liée à la facture').then((ok) => { if (ok) onClose(); });
  };
  const unlink = (transactionId: number) => {
    void run(() => api.unlinkBillMatch(userId, bill.id, transactionId), 'Lien retiré').then((ok) => { if (ok) onClose(); });
  };

  return (
    <Modal title={`Lier une dépense à « ${bill.name} »`} onClose={onClose}>
      <p className="pg-note">Le paiement n’a pas été repéré (espèces, libellé variable) ? Lie la dépense : elle comptera pour son mois.</p>
      {manualMatches.length > 0 && (
        <div className="full refund-selected-list">
          {manualMatches.map((t) => (
            <span key={t.id}>
              {dayLabel(t.date, true)} · {t.description ?? `#${t.id}`} · {money(t.amount, currency)}
              <button type="button" className="ghost-button" onClick={() => unlink(t.id)} aria-label="Retirer le lien"><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
      <label className="full">
        <div className="search-box inline"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher la dépense (libellé)…" autoFocus /></div>
      </label>
      <div className="full refund-candidates">
        {searching && candidates.length === 0 && <p className="empty">Recherche…</p>}
        {!searching && candidates.length === 0 && <p className="empty">Aucune dépense trouvée.</p>}
        {candidates.map((t) => {
          const txCurrency = accountById.get(t.account_id ?? -1)?.currency ?? 'EUR';
          const alreadyLinked = manualMatches.some((m) => m.id === t.id);
          return (
            <div key={t.id} className="refund-candidate">
              <span>{dayLabel(t.date, true)} · {t.description ?? `#${t.id}`} · {money(t.amount, txCurrency)}</span>
              <button type="button" className="secondary" disabled={alreadyLinked} onClick={() => link(t.id)}>
                {alreadyLinked ? 'Déjà lié' : 'Lier'}
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="secondary" onClick={onClose}>Fermer</button>
    </Modal>
  );
}
