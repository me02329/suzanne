import { FormEvent, useState } from 'react';
import { Landmark, Pencil } from 'lucide-react';
import {
  ACCOUNT_TYPES,
  REPORT_CURRENCIES,
  accountTypeLabel,
  type Account,
  type AccountSnapshot,
  type Institution,
} from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { money, todayIso } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';

type Run = (fn: () => Promise<unknown>, message?: string) => Promise<void>;

export function Accounts({ userId, accounts, institutions, snapshots, institutionById, run }: {
  userId: number;
  accounts: Account[];
  institutions: Institution[];
  snapshots: AccountSnapshot[];
  institutionById: Map<number, Institution>;
  run: Run;
}) {
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      institution_id: (() => { const v = data.get('institution_id'); return v && Number(v) > 0 ? Number(v) : null; })(),
      name: String(data.get('name')),
      type: String(data.get('type')) as Account['type'],
      currency: String(data.get('currency') || 'EUR'),
      initial_balance: Number(data.get('initial_balance') || 0),
      initial_balance_date: String(data.get('initial_balance_date')),
    };
    if (editingAccount) {
      void run(() => api.updateAccount(userId, editingAccount.id, body), 'Compte modifié');
      setEditingAccount(null);
    } else {
      void run(() => api.createAccount(userId, body));
    }
    event.currentTarget.reset();
  };

  const submitInstitution = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createInstitution(userId, { name: String(data.get('name')) }), 'Institution ajoutée');
    event.currentTarget.reset();
  };

  const submitSnapshot = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.setSnapshot(userId, {
      account_id: Number(data.get('account_id')),
      date: String(data.get('date')),
      balance: Number(data.get('balance')),
    }), 'Snapshot enregistré');
    event.currentTarget.reset();
  };

  return (
    <section className="split">
      <div className="stack">
        <Panel title="Nouvelle institution">
          <form className="form" onSubmit={submitInstitution}>
            <label>Nom<input name="name" required placeholder="Banque, broker, caisse..." /></label>
            <button className="primary">Ajouter</button>
          </form>
        </Panel>
        <Panel title={editingAccount ? 'Modifier le compte' : 'Nouveau compte'}>
          <form className="form" onSubmit={submit} key={editingAccount?.id ?? 'new-account'}>
            <label>Institution<select name="institution_id" defaultValue={editingAccount?.institution_id ?? ''}><option value="">Aucune</option>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
            <label>Nom<input name="name" defaultValue={editingAccount?.name ?? ''} required /></label>
            <label>Type<select name="type" defaultValue={editingAccount?.type ?? 'checking'}>{ACCOUNT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label>Devise<select name="currency" defaultValue={editingAccount?.currency ?? 'EUR'} required>{REPORT_CURRENCIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label>Solde initial<input name="initial_balance" type="number" step="0.01" defaultValue={editingAccount?.initial_balance ?? 0} /></label>
            <label>Date initiale<input name="initial_balance_date" type="date" defaultValue={editingAccount?.initial_balance_date?.slice(0, 10) ?? todayIso()} required /></label>
            <button className="primary"><Landmark size={16} /> {editingAccount ? 'Enregistrer' : 'Ajouter'}</button>
            {editingAccount && <button type="button" className="secondary" onClick={() => setEditingAccount(null)}>Annuler</button>}
          </form>
        </Panel>
        <Panel title="Snapshot de solde">
          <form className="form" onSubmit={submitSnapshot}>
            <label>Compte<select name="account_id" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
            <label>Solde<input name="balance" type="number" step="0.01" required /></label>
            <button className="primary">Enregistrer</button>
          </form>
        </Panel>
      </div>
      <div className="stack">
        <Panel title="Comptes">
          <DataTable empty={accounts.length === 0 ? 'Aucun compte.' : null}>
            <thead><tr><th>Compte</th><th>Institution</th><th>Type</th><th>Devise</th><th className="amount-cell">Solde initial</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.name}</strong><span>Depuis le {new Date(a.initial_balance_date).toLocaleDateString('fr-FR')}</span></td>
                  <td>{institutionById.get(a.institution_id ?? -1)?.name ?? 'Sans institution'}</td>
                  <td>{accountTypeLabel(a.type)}</td>
                  <td>{a.currency}</td>
                  <td className="amount-cell">{money(a.initial_balance, a.currency)}</td>
                  <td className="actions-cell">
                    <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditingAccount(a)} />
                    <IconButton label="Supprimer" confirm={`Supprimer le compte « ${a.name} » et toutes ses transactions ?`} onClick={() => void run(() => api.deleteAccount(userId, a.id), 'Compte supprimé')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
        <Panel title="Institutions">
          <DataTable empty={institutions.length === 0 ? 'Aucune institution.' : null}>
            <thead><tr><th>Nom</th><th>Créée le</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {institutions.map((i) => (
                <tr key={i.id}>
                  <td><strong>{i.name}</strong></td>
                  <td>{new Date(i.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="actions-cell"><IconButton label="Supprimer" confirm={`Supprimer l'institution « ${i.name} » ?`} onClick={() => void run(() => api.deleteInstitution(userId, i.id), 'Institution supprimée')} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
        <Panel title="Snapshots récents">
          <DataTable empty={snapshots.length === 0 ? 'Aucun snapshot.' : null}>
            <thead><tr><th>Date</th><th>Compte</th><th className="amount-cell">Solde</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {snapshots.slice(0, 8).map((s) => {
                const account = accounts.find((a) => a.id === s.account_id);
                return (
                  <tr key={s.id}>
                    <td>{new Date(s.date).toLocaleDateString('fr-FR')}</td>
                    <td>{account?.name ?? 'Compte'}</td>
                    <td className="amount-cell">{money(s.balance, account?.currency ?? 'EUR')}</td>
                    <td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteSnapshot(userId, s.id), 'Snapshot supprimé')} /></td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </section>
  );
}
