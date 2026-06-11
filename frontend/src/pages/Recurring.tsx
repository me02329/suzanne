import { FormEvent, useMemo, useState } from 'react';
import { ArrowUpCircle, CalendarClock, ChevronDown, ChevronRight, ChevronUp, PauseCircle, Pencil, PlayCircle, Plus, Repeat } from 'lucide-react';
import { nextRecurringOccurrence, type Account, type Category, type DashboardSummary, type RecurringFrequency, type RecurringTransaction } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { numberOrNull } from '../lib/forms';
import { formatRelativeDate, money, recurringFrequencyLabel } from '../lib/format';
import { cadenceTotals, groupByCadence, type CadenceGroup } from '../lib/subscriptions';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
].map((label, i) => ({ value: i + 1, label }));

export function Recurring({ userId, recurring, accounts, categories, categoryById, accountById, summary, reportCurrency, run }: {
  userId: number;
  recurring: RecurringTransaction[];
  accounts: Account[];
  categories: Category[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  summary: DashboardSummary | null;
  reportCurrency: string;
  run: Run;
}) {
  const [addOpen, setAddOpen] = usePersistedState<boolean>('recurring_add_open', recurring.length === 0);
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  // Frequency is tracked in state so the "Mois" selector can appear only for
  // yearly recurrences, in both the add form and the edit modal.
  const [addFreq, setAddFreq] = useState<RecurringFrequency>('monthly');
  const [editFreq, setEditFreq] = useState<RecurringFrequency>('monthly');
  const currentMonth = new Date().getMonth() + 1;
  // Per-cadence collapse, persisted across sessions. Default open (a missing
  // key means expanded); keys are namespaced by panel so the monthly section of
  // expenses and of income fold independently.
  const [collapsed, setCollapsed] = usePersistedState<Record<string, boolean>>('recurring_groups_collapsed', {});
  const toggleGroup = (key: string) => setCollapsed({ ...collapsed, [key]: !collapsed[key] });

  const displayCurrency = summary?.currency ?? reportCurrency;

  // Converts a recurring amount (in its account's currency) to the report
  // currency, mirroring the dashboard/forecast wiring.
  const rateFor = useMemo(() => {
    const rates = summary?.exchange_rates ?? {};
    return (accountId: number | null) => {
      const currency = (accountId != null ? accountById.get(accountId)?.currency : null) ?? 'EUR';
      return rates[currency] ?? 1;
    };
  }, [summary, accountById]);

  // Recurring split by direction, then bucketed by cadence so each payment is
  // shown at its real period (a yearly charge stays yearly, never ÷12).
  const expenseGroups = useMemo(
    () => groupByCadence(recurring.filter((r) => r.type === 'expense'), rateFor),
    [recurring, rateFor],
  );
  const incomeGroups = useMemo(
    () => groupByCadence(recurring.filter((r) => r.type === 'income'), rateFor),
    [recurring, rateFor],
  );
  const expenseTotals = useMemo(
    () => cadenceTotals(recurring.filter((r) => r.type === 'expense' && r.active), rateFor),
    [recurring, rateFor],
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => api.createRecurring(userId, {
      account_id: numberOrNull(data.get('account_id')),
      category_id: numberOrNull(data.get('category_id')),
      amount: Number(data.get('amount')),
      type: String(data.get('type')) as 'expense' | 'income',
      description: String(data.get('description')),
      frequency: String(data.get('frequency')) as RecurringFrequency,
      interval: Number(data.get('interval') || 1),
      day_of_month: Number(data.get('day_of_month') || 1),
      month_of_year: numberOrNull(data.get('month_of_year')),
      active: true,
    }), 'Récurrent ajouté');
    form.reset();
    setAddFreq('monthly');
  };

  // Édition d'un récurrent existant : une augmentation de prix ou un changement
  // de cadence reste le même abonnement, on modifie en place plutôt que de
  // supprimer/recréer (ce qui perdrait l'historique de génération).
  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.updateRecurring(userId, editing.id, {
      account_id: numberOrNull(data.get('account_id')),
      category_id: numberOrNull(data.get('category_id')),
      amount: Number(data.get('amount')),
      type: String(data.get('type')) as 'expense' | 'income',
      description: String(data.get('description')),
      frequency: String(data.get('frequency')) as RecurringFrequency,
      interval: Number(data.get('interval') || 1),
      day_of_month: Number(data.get('day_of_month') || 1),
      month_of_year: numberOrNull(data.get('month_of_year')),
    }), 'Récurrent modifié');
    setEditing(null);
  };

  const renderGroups = (groups: CadenceGroup[], prefix: string) => groups.map((group) => {
    const key = `${prefix}:${group.cadence}`;
    const open = !collapsed[key];
    return (
    <div className="cadence-group" key={group.cadence}>
      <button type="button" className="cadence-group-head" onClick={() => toggleGroup(key)} aria-expanded={open}>
        <span className="cadence-group-title">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {group.label}
          <small>{group.rows.length}</small>
        </span>
        <strong>{money(group.total, displayCurrency)}<small>{group.unit}</small></strong>
      </button>
      {open && (
      <DataTable empty={null}>
        <thead>
          <tr>
            <th>Libellé</th>
            <th className="amount-cell">Montant</th>
            <th>Prochaine</th>
            <th>Compte</th>
            <th>Catégorie</th>
            <th className="actions-cell">Actions</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map(({ r, native }) => {
            const account = accountById.get(r.account_id ?? -1);
            const currency = account?.currency ?? 'EUR';
            const occurrence = formatRelativeDate(r.active ? nextRecurringOccurrence(r) : null);
            const soon = occurrence.days != null && occurrence.days <= 7;
            const sign = r.type === 'income' ? '+' : '-';
            const tone = r.type === 'income' ? 'income' : 'expense';
            return (
              <tr key={r.id} className={r.active ? undefined : 'row-muted'}>
                <td data-label="Libellé">
                  <strong title={r.description}>{r.description}</strong>
                  <span>{recurringFrequencyLabel(r.frequency, r.interval ?? 1)}{r.active ? '' : ' · Inactif'}</span>
                </td>
                <td className={`amount-cell ${tone}`} data-label="Montant">{sign}{money(native, currency)}<small className="cadence-unit">{group.unit}</small></td>
                <td data-label="Prochaine" className={soon ? 'recurring-soon' : undefined}>{r.active ? occurrence.label : '—'}</td>
                <td data-label="Compte">{account?.name ?? 'Sans compte'}</td>
                <td data-label="Catégorie">{categoryById.get(r.category_id ?? -1)?.name ?? 'Sans catégorie'}</td>
                <td className="actions-cell">
                  <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => { setEditing(r); setEditFreq(r.frequency); }} />
                  <IconButton
                    label={r.active ? 'Désactiver' : 'Activer'}
                    tone="neutral"
                    icon={r.active ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                    onClick={() => void run(() => api.updateRecurring(userId, r.id, { active: !r.active }), r.active ? 'Récurrent désactivé' : 'Récurrent activé')}
                  />
                  <IconButton label="Supprimer" confirm={`Supprimer le récurrent « ${r.description} » ?`} onClick={() => void run(() => api.deleteRecurring(userId, r.id), 'Récurrent supprimé')} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      )}
    </div>
    );
  });

  // At-a-glance totals, each in its own unit and never summed across cadences —
  // a yearly lump and a monthly charge aren't the same kind of money.
  const summaryParts = ([
    ['Mensuels', expenseTotals.monthly, '/mois'],
    ['Périodiques', expenseTotals.periodic, '/an'],
    ['Hebdo', expenseTotals.weekly, '/sem'],
  ] as const).filter(([, value]) => value > 0);

  return (
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setAddOpen(!addOpen)}
          aria-expanded={addOpen}
        >
          <span className="collapsible-title"><Plus size={16} /> Nouvelle transaction récurrente</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {addOpen && (
          <div className="collapsible-body">
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">Description<input name="description" required /></label>
              <label>Type<select name="type"><option value="expense">Dépense</option><option value="income">Revenu</option></select></label>
              <label>Montant<input name="amount" type="number" min="0.01" step="0.01" required /></label>
              <label>Fréquence<select name="frequency" value={addFreq} onChange={(e) => setAddFreq(e.target.value as RecurringFrequency)}><option value="weekly">Semaines</option><option value="monthly">Mois</option><option value="yearly">Années</option></select></label>
              <label>Tous les<input name="interval" type="number" min="1" max="120" defaultValue="1" required /></label>
              {addFreq === 'yearly' && (
                <label>Mois<select name="month_of_year" defaultValue={currentMonth}>{MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
              )}
              <label>Jour<input name="day_of_month" type="number" min="1" max="31" defaultValue="1" /></label>
              <label>Compte<select name="account_id"><option value="">Aucun</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label>Catégorie<select name="category_id"><option value="">Aucune</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <button className="primary"><CalendarClock size={16} /> Ajouter</button>
              <button type="button" className="secondary" onClick={() => void run(() => api.generateRecurring(userId), 'Récurrents générés')}>Générer ce mois</button>
            </form>
          </div>
        )}
      </div>

      <Panel title="Engagements récurrents" icon={<Repeat />}>
        {summaryParts.length > 0 && (
          <p className="panel-note cadence-summary">
            {summaryParts.map(([label, value, unit], i) => (
              <span key={label}>{i > 0 ? ' · ' : ''}{label} <strong className="expense">{money(value, displayCurrency)}{unit}</strong></span>
            ))}
          </p>
        )}
        {expenseGroups.length > 0 ? renderGroups(expenseGroups, 'exp') : <p className="empty">Aucune dépense récurrente.</p>}
      </Panel>

      {incomeGroups.length > 0 && (
        <Panel title="Revenus récurrents" icon={<ArrowUpCircle />}>
          {renderGroups(incomeGroups, 'inc')}
        </Panel>
      )}

      {editing && (
        <Modal title={`Modifier "${editing.description}"`} onClose={() => setEditing(null)}>
          <form className="form" onSubmit={submitEdit}>
            <label>Description<input name="description" defaultValue={editing.description} required /></label>
            <label>Type
              <select name="type" defaultValue={editing.type}>
                <option value="expense">Dépense</option>
                <option value="income">Revenu</option>
              </select>
            </label>
            <label>Montant<input name="amount" type="number" min="0.01" step="0.01" defaultValue={editing.amount} required /></label>
            <label>Fréquence
              <select name="frequency" value={editFreq} onChange={(e) => setEditFreq(e.target.value as RecurringFrequency)}>
                <option value="weekly">Semaines</option>
                <option value="monthly">Mois</option>
                <option value="yearly">Années</option>
              </select>
            </label>
            <label>Tous les<input name="interval" type="number" min="1" max="120" defaultValue={editing.interval ?? 1} required /></label>
            {editFreq === 'yearly' && (
              <label>Mois
                <select name="month_of_year" defaultValue={editing.month_of_year ?? currentMonth}>
                  {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
            )}
            <label>Jour<input name="day_of_month" type="number" min="1" max="31" defaultValue={editing.day_of_month ?? 1} /></label>
            <label>Compte
              <select name="account_id" defaultValue={editing.account_id ?? ''}>
                <option value="">Aucun</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label>Catégorie
              <select name="category_id" defaultValue={editing.category_id ?? ''}>
                <option value="">Aucune</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button className="primary">Enregistrer</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>Annuler</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
