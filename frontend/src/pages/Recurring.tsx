import { FormEvent, useMemo } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { nextRecurringOccurrence, type Account, type Category, type RecurringFrequency, type RecurringTransaction } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { numberOrNull } from '../lib/forms';
import { formatRelativeDate, money, recurringFrequencyLabel } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

export function Recurring({ userId, recurring, accounts, categories, categoryById, accountById, run }: {
  userId: number;
  recurring: RecurringTransaction[];
  accounts: Account[];
  categories: Category[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  run: Run;
}) {
  const [addOpen, setAddOpen] = usePersistedState<boolean>('recurring_add_open', recurring.length === 0);

  // Calcule la prochaine occurrence de chaque récurrent actif et trie par
  // échéance croissante (les inactifs, sans prochaine date, vont en fin de liste).
  const rows = useMemo(() => {
    return recurring
      .map((r) => ({
        r,
        next: r.active ? nextRecurringOccurrence(r) : null,
      }))
      .sort((a, b) => {
        if (a.next && b.next) return a.next.localeCompare(b.next);
        if (a.next) return -1;
        if (b.next) return 1;
        return a.r.description.localeCompare(b.r.description);
      });
  }, [recurring]);

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
      active: true,
    }), 'Récurrent ajouté');
    form.reset();
  };
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
              <label>Fréquence<select name="frequency" defaultValue="monthly"><option value="weekly">Semaines</option><option value="monthly">Mois</option><option value="yearly">Années</option></select></label>
              <label>Tous les<input name="interval" type="number" min="1" max="120" defaultValue="1" required /></label>
              <label>Jour<input name="day_of_month" type="number" min="1" max="31" defaultValue="1" /></label>
              <label>Compte<select name="account_id"><option value="">Aucun</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label>Catégorie<select name="category_id"><option value="">Aucune</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <button className="primary"><CalendarClock size={16} /> Ajouter</button>
              <button type="button" className="secondary" onClick={() => void run(() => api.generateRecurring(userId), 'Récurrents générés')}>Générer ce mois</button>
            </form>
          </div>
        )}
      </div>

      <Panel title="Récurrents" icon={<CalendarClock />}>
        <DataTable empty={recurring.length === 0 ? 'Aucune transaction récurrente.' : null}>
          <thead><tr><th>Description</th><th>Type</th><th className="amount-cell">Montant</th><th>Fréquence</th><th>Prochaine</th><th>Compte</th><th>Catégorie</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {rows.map(({ r, next }) => {
              const account = accountById.get(r.account_id ?? -1);
              const occurrence = formatRelativeDate(next);
              const soon = occurrence.days != null && occurrence.days <= 7;
              return (
                <tr key={r.id}>
                  <td><strong>{r.description}</strong><span>{r.active ? 'Actif' : 'Inactif'}</span></td>
                  <td><span className={`pill ${r.type}`}>{r.type === 'income' ? 'Revenu' : 'Dépense'}</span></td>
                  <td className={`amount-cell ${r.type === 'income' ? 'income' : 'expense'}`}>{r.type === 'income' ? '+' : '-'}{money(r.amount, account?.currency ?? 'EUR')}</td>
                  <td>{recurringFrequencyLabel(r.frequency, r.interval ?? 1)}</td>
                  <td className={soon ? 'recurring-soon' : undefined}>{occurrence.label}</td>
                  <td>{account?.name ?? 'Sans compte'}</td>
                  <td>{categoryById.get(r.category_id ?? -1)?.name ?? 'Sans catégorie'}</td>
                  <td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteRecurring(userId, r.id), 'Récurrent supprimé')} /></td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}
