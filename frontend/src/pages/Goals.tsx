import { FormEvent, useState } from 'react';
import { ChevronDown, ChevronUp, Coins, Link2, Pencil, PiggyBank, Plus } from 'lucide-react';
import type { Account, SavingsGoal } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { money, todayIso } from '../lib/format';
import { numberOrNull } from '../lib/forms';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

export function Goals({ userId, goals, accounts, accountById, run }: {
  userId: number;
  goals: SavingsGoal[];
  accounts: Account[];
  accountById: Map<number, Account>;
  run: Run;
}) {
  const [contributing, setContributing] = useState<SavingsGoal | null>(null);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [addOpen, setAddOpen] = usePersistedState<boolean>('goals_add_open', goals.length === 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createGoal(userId, {
      name: String(data.get('name')),
      target_amount: Number(data.get('target_amount')),
      current_amount: Number(data.get('current_amount') || 0),
      deadline: String(data.get('deadline') || '') || null,
      color: String(data.get('color')),
      account_id: numberOrNull(data.get('account_id')),
    }), 'Objectif ajouté');
    event.currentTarget.reset();
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.updateGoal(userId, editing.id, {
      name: String(data.get('name')),
      target_amount: Number(data.get('target_amount')),
      current_amount: Number(data.get('current_amount') || 0),
      deadline: String(data.get('deadline') || '') || null,
      color: String(data.get('color')),
      account_id: numberOrNull(data.get('account_id')),
    }), 'Objectif modifié');
    setEditing(null);
  };

  const submitContribution = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contributing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.contributeGoal(userId, contributing.id, {
      amount: Number(data.get('amount')),
      date: String(data.get('date')),
      source_account_id: numberOrNull(data.get('source_account_id')),
      description: String(data.get('description') || '') || null,
    }), 'Versement enregistré');
    setContributing(null);
  };

  return (
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouvel objectif</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {addOpen && (
          <div className="collapsible-body">
            <p className="panel-note">
              Lié à un compte : la progression peut être alimentée par un versement (transfert depuis un autre compte).
              Sans compte : reste un compteur manuel.
            </p>
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">Nom<input name="name" required /></label>
              <label>Cible<input name="target_amount" type="number" min="0.01" step="0.01" required /></label>
              <label>Actuel<input name="current_amount" type="number" min="0" step="0.01" defaultValue="0" /></label>
              <label>Compte de l'objectif
                <select name="account_id">
                  <option value="">Aucun (compteur manuel)</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>Échéance<input name="deadline" type="date" /></label>
              <label>Couleur<input name="color" type="color" defaultValue="#4f46e5" /></label>
              <button className="primary"><Plus size={16} /> Ajouter</button>
            </form>
          </div>
        )}
      </div>
      <Panel title="Objectifs" icon={<PiggyBank />}>
        <DataTable empty={goals.length === 0 ? 'Aucun objectif.' : null}>
          <thead><tr><th>Objectif</th><th>Compte</th><th className="amount-cell">Actuel</th><th className="amount-cell">Cible</th><th>Progression</th><th>Échéance</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {goals.map((g) => {
              const pct = Math.min(100, (g.current_amount / g.target_amount) * 100);
              const account = g.account_id != null ? accountById.get(g.account_id) : null;
              return (
                <tr key={g.id}>
                  <td><span className="dot inline" style={{ background: g.color }} /><strong>{g.name}</strong></td>
                  <td>{account ? <span className="goal-account"><Link2 size={12} /> {account.name}</span> : <span className="muted">Manuel</span>}</td>
                  <td className="amount-cell">{money(g.current_amount)}</td>
                  <td className="amount-cell">{money(g.target_amount)}</td>
                  <td><div className="bar"><span style={{ width: `${pct}%`, background: g.color }} /></div><span>{Math.round(pct)} %</span></td>
                  <td>{g.deadline ? new Date(g.deadline).toLocaleDateString('fr-FR') : '-'}</td>
                  <td className="actions-cell">
                    <IconButton label="Verser" tone="accent" icon={<Coins size={16} />} onClick={() => setContributing(g)} />
                    <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(g)} />
                    <IconButton label="Supprimer" confirm="Supprimer cet objectif ?" onClick={() => void run(() => api.deleteGoal(userId, g.id), 'Objectif supprimé')} />
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
            <label>Nom<input name="name" defaultValue={editing.name} required /></label>
            <label>Cible<input name="target_amount" type="number" min="0.01" step="0.01" defaultValue={editing.target_amount} required /></label>
            <label>Actuel<input name="current_amount" type="number" min="0" step="0.01" defaultValue={editing.current_amount} /></label>
            <label>Compte de l'objectif
              <select name="account_id" defaultValue={editing.account_id ?? ''}>
                <option value="">Aucun (compteur manuel)</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label>Échéance<input name="deadline" type="date" defaultValue={editing.deadline ? editing.deadline.slice(0, 10) : ''} /></label>
            <label>Couleur<input name="color" type="color" defaultValue={editing.color} /></label>
            <button className="primary">Enregistrer</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>Annuler</button>
          </form>
        </Modal>
      )}

      {contributing && (
        <Modal title={`Verser sur "${contributing.name}"`} onClose={() => setContributing(null)}>
          <form className="form" onSubmit={submitContribution}>
            <p className="panel-note">
              {contributing.account_id
                ? 'Choisis un compte source : un transfert est créé du compte source vers le compte de l\'objectif.'
                : 'Cet objectif n\'a pas de compte lié — la contribution incrémente uniquement le compteur.'}
            </p>
            <label>Montant<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
            {contributing.account_id != null && (
              <label>Depuis le compte
                <select name="source_account_id">
                  <option value="">Aucun (juste compteur)</option>
                  {accounts.filter((a) => a.id !== contributing.account_id).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="full">Libellé (optionnel)<input name="description" placeholder="Ex: Versement mensuel" /></label>
            <button className="primary"><Coins size={16} /> Enregistrer le versement</button>
            <button type="button" className="secondary" onClick={() => setContributing(null)}>Annuler</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
