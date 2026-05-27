import { FormEvent } from 'react';
import { CalendarClock } from 'lucide-react';
import type { Account, Category, RecurringFrequency, RecurringTransaction } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { numberOrNull } from '../lib/forms';
import { money, recurringFrequencyLabel } from '../lib/format';
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
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
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
    }));
    event.currentTarget.reset();
  };
  return (
    <section className="split">
      <Panel title="Nouvelle transaction récurrente">
        <form className="form" onSubmit={submit}>
          <label>Description<input name="description" required /></label>
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
      </Panel>
      <Panel title="Récurrents">
        <DataTable empty={recurring.length === 0 ? 'Aucune transaction récurrente.' : null}>
          <thead><tr><th>Description</th><th>Type</th><th className="amount-cell">Montant</th><th>Fréquence</th><th>Jour</th><th>Compte</th><th>Catégorie</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {recurring.map((r) => {
              const account = accountById.get(r.account_id ?? -1);
              return (
                <tr key={r.id}>
                  <td><strong>{r.description}</strong><span>{r.active ? 'Actif' : 'Inactif'}</span></td>
                  <td><span className={`pill ${r.type}`}>{r.type === 'income' ? 'Revenu' : 'Dépense'}</span></td>
                  <td className={`amount-cell ${r.type === 'income' ? 'income' : 'expense'}`}>{r.type === 'income' ? '+' : '-'}{money(r.amount, account?.currency ?? 'EUR')}</td>
                  <td>{recurringFrequencyLabel(r.frequency, r.interval ?? 1)}</td>
                  <td>{r.day_of_month ?? 1}</td>
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
