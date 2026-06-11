import { FormEvent, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Pencil, Plus, Power, ReceiptText } from 'lucide-react';
import type { Account, Bill, BillStatusEntry, BillsStatusSummary, Category } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { formatMonthLong, money } from '../lib/format';
import { numberOrNull } from '../lib/forms';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';

import type { Run } from '../lib/run';

const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Mensuelle' },
  { value: 'yearly', label: 'Annuelle' },
] as const;

function frequencyLabel(bill: Bill): string {
  const base = bill.frequency === 'yearly' ? 'an' : 'mois';
  return bill.interval > 1 ? `Tous les ${bill.interval} ${base}` : bill.frequency === 'yearly' ? 'Annuelle' : 'Mensuelle';
}

// Libellé + classe de pastille par statut. `not_due` couvre aussi les
// factures inactives (le backend ne les déclare jamais dues).
function statusBadge(entry: BillStatusEntry): { label: string; className: string } {
  if (!entry.bill.active) return { label: 'Inactive', className: 'pill' };
  switch (entry.status) {
    case 'paid': return { label: '✓ Payée', className: 'pill income' };
    case 'paid_out_of_range': return { label: 'Payée hors fourchette', className: 'pill expense' };
    case 'late': return { label: 'En retard', className: 'pill expense' };
    case 'pending': return { label: 'À venir', className: 'pill transfer' };
    case 'not_due': return { label: 'Hors cadence ce mois', className: 'pill' };
  }
}

export function Bills({ userId, month, billsStatus, accounts, categories, accountById, run }: {
  userId: number;
  month: string;
  billsStatus: BillsStatusSummary | null;
  accounts: Account[];
  categories: Category[];
  accountById: Map<number, Account>;
  run: Run;
}) {
  const [editing, setEditing] = useState<Bill | null>(null);
  const entries = billsStatus?.bills ?? [];
  const [addOpen, setAddOpen] = usePersistedState<boolean>('bills_add_open', entries.length === 0);
  const expenseCategories = categories.filter((c) => c.type === 'expense');

  const billPayload = (data: FormData) => ({
    name: String(data.get('name')),
    amount_min: Number(data.get('amount_min')),
    amount_max: Number(data.get('amount_max')),
    start_date: String(data.get('start_date')),
    frequency: String(data.get('frequency')) as Bill['frequency'],
    interval: Number(data.get('interval') || 1),
    pattern: String(data.get('pattern') || '') || null,
    account_id: numberOrNull(data.get('account_id')),
    category_id: numberOrNull(data.get('category_id')),
  });

  const submitAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run(() => api.createBill(userId, billPayload(new FormData(form))), 'Facture attendue ajoutée')
      .then((ok) => { if (ok) form.reset(); });
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    void run(() => api.updateBill(userId, editing.id, billPayload(new FormData(event.currentTarget))), 'Facture modifiée');
    setEditing(null);
  };

  const billFields = (bill?: Bill) => (
    <>
      <label className="grow">Nom<input name="name" defaultValue={bill?.name ?? ''} placeholder="Ex: Électricité" required /></label>
      <label>Montant min<input name="amount_min" type="number" min="0.01" step="0.01" defaultValue={bill?.amount_min ?? ''} required /></label>
      <label>Montant max<input name="amount_max" type="number" min="0.01" step="0.01" defaultValue={bill?.amount_max ?? ''} required /></label>
      <label>Première échéance<input name="start_date" type="date" defaultValue={bill?.start_date?.slice(0, 10) ?? `${month}-01`} required /></label>
      <label>Fréquence
        <select name="frequency" defaultValue={bill?.frequency ?? 'monthly'}>
          {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </label>
      <label>Intervalle<input name="interval" type="number" min="1" max="24" defaultValue={bill?.interval ?? 1} title="2 = tous les 2 mois/ans, 3 = trimestrielle…" /></label>
      <label className="grow">Motif de rapprochement<input name="pattern" defaultValue={bill?.pattern ?? ''} placeholder="Ex: EDF (vide = le nom)" /></label>
      <label>Compte
        <select name="account_id" defaultValue={bill?.account_id ?? ''}>
          <option value="">Tous</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label>Catégorie
        <select name="category_id" defaultValue={bill?.category_id ?? ''}>
          <option value="">Toutes</option>
          {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
    </>
  );

  return (
    <section className="stack">
      {billsStatus && entries.length > 0 && (
        <section className="stats">
          <Stat icon={<ReceiptText />} label={`Attendues en ${formatMonthLong(billsStatus.month)}`} value={`${billsStatus.due_count}`} />
          <Stat icon={<CheckCircle2 />} label="Payées" value={`${billsStatus.paid_count} / ${billsStatus.due_count}`} positive={billsStatus.paid_count >= billsStatus.due_count} />
          <Stat icon={<ReceiptText />} label="Payé / attendu (milieu de fourchette)" value={`${money(billsStatus.paid_total)} / ${money(billsStatus.expected_total)}`} />
        </section>
      )}

      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouvelle facture attendue</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {addOpen && (
          <div className="collapsible-body">
            <p className="panel-note">
              Une dépense récurrente attendue avec une fourchette (ex: électricité 80–130 €). Chaque mois dû,
              elle est rapprochée des dépenses dont la description contient le motif : payée ? dans la fourchette ? en retard ?
            </p>
            <form className="form form-inline" onSubmit={submitAdd}>
              {billFields()}
              <button className="primary"><Plus size={16} /> Ajouter</button>
            </form>
          </div>
        )}
      </div>

      <Panel title={`Factures de ${formatMonthLong(month)}`} icon={<ReceiptText />}>
        <DataTable empty={entries.length === 0 ? 'Aucune facture attendue. Ajoute tes charges récurrentes variables (électricité, eau…) pour suivre leur paiement mois par mois.' : null}>
          <thead>
            <tr>
              <th>Facture</th>
              <th>Fourchette</th>
              <th>Cadence</th>
              <th>Échéance</th>
              <th>Statut</th>
              <th className="amount-cell">Payé</th>
              <th className="actions-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const bill = entry.bill;
              const badge = statusBadge(entry);
              const currency = bill.account_id != null ? accountById.get(bill.account_id)?.currency ?? 'EUR' : 'EUR';
              const muted = !bill.active || entry.status === 'not_due';
              return (
                <tr key={bill.id} style={muted ? { opacity: 0.55 } : undefined}>
                  <td data-label="Facture">
                    <strong title={bill.name}>{bill.name}</strong>
                    {bill.pattern && <span className="muted"> · motif « {bill.pattern} »</span>}
                  </td>
                  <td data-label="Fourchette">{money(bill.amount_min, currency)} – {money(bill.amount_max, currency)}</td>
                  <td data-label="Cadence">{frequencyLabel(bill)}</td>
                  <td data-label="Échéance">{entry.expected_date ? new Date(entry.expected_date).toLocaleDateString('fr-FR') : '—'}</td>
                  <td data-label="Statut"><span className={badge.className}>{badge.label}</span></td>
                  <td className="amount-cell" data-label="Payé">
                    {entry.paid_amount > 0 ? (
                      <span title={entry.matched_transactions.map((t) => `${new Date(t.date).toLocaleDateString('fr-FR')} · ${t.description ?? `#${t.id}`} · ${money(t.amount, currency)}`).join('\n')}>
                        {money(entry.paid_amount, currency)}
                        {entry.matched_transactions.length > 1 && <span className="muted"> ({entry.matched_transactions.length} tx)</span>}
                      </span>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="actions-cell">
                    <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(bill)} />
                    <IconButton
                      label={bill.active ? 'Désactiver (plus jamais due)' : 'Réactiver'}
                      tone={bill.active ? 'accent' : 'neutral'}
                      icon={<Power size={16} />}
                      onClick={() => void run(() => api.updateBill(userId, bill.id, { active: !bill.active }), bill.active ? 'Facture désactivée' : 'Facture réactivée')}
                    />
                    <IconButton label="Supprimer" confirm="Supprimer cette facture attendue ?" onClick={() => void run(() => api.deleteBill(userId, bill.id), 'Facture supprimée')} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>

      {editing && (
        <Modal title={`Modifier "${editing.name}"`} onClose={() => setEditing(null)}>
          <form className="form" onSubmit={submitEdit}>
            {billFields(editing)}
            <button className="primary">Enregistrer</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>Annuler</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
