import { FormEvent, useMemo, useState } from 'react';
import { CalendarCheck, Landmark, Pencil } from 'lucide-react';
import {
  ACCOUNT_TYPES,
  REPORT_CURRENCIES,
  accountTypeLabel,
  accountTypeGroup,
  accountGroupLabel,
  type Account,
  type AccountSnapshot,
  type DashboardSummary,
  type Institution,
} from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { lastDayOfPreviousMonthIso, money, todayIso } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

export function Accounts({ userId, accounts, institutions, snapshots, institutionById, summary, run }: {
  userId: number;
  accounts: Account[];
  institutions: Institution[];
  snapshots: AccountSnapshot[];
  institutionById: Map<number, Institution>;
  summary: DashboardSummary | null;
  run: Run;
}) {
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [snapshotDate, setSnapshotDate] = useState<string>(() => lastDayOfPreviousMonthIso());
  const [snapshotInputs, setSnapshotInputs] = useState<Record<number, string>>({});

  // Group accounts by accountTypeGroup so the batch form shows them in
  // sensible buckets (Liquidités, Livrets, Investissements…) instead of a
  // flat list.
  const accountsByGroup = useMemo(() => {
    const buckets = new Map<string, Account[]>();
    for (const account of accounts) {
      const group = accountTypeGroup(account.type);
      const list = buckets.get(group) ?? [];
      list.push(account);
      buckets.set(group, list);
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }
    return buckets;
  }, [accounts]);

  const estimatedByAccount = useMemo(() => {
    return new Map((summary?.account_balances ?? []).map((row) => [row.account_id, row]));
  }, [summary]);

  const submitSnapshotBatch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const balances = Object.entries(snapshotInputs)
      .filter(([, raw]) => raw.trim() !== '')
      .map(([id, raw]) => ({ account_id: Number(id), balance: Number(raw.replace(',', '.')) }))
      .filter((entry) => Number.isFinite(entry.balance));
    if (balances.length === 0) return;
    void run(
      () => api.setSnapshotBatch(userId, { date: snapshotDate, balances }),
      (result) => {
        const { created, updated } = result as { created: number; updated: number };
        const parts: string[] = [];
        if (created > 0) parts.push(`${created} créé${created > 1 ? 's' : ''}`);
        if (updated > 0) parts.push(`${updated} mis à jour`);
        return parts.length > 0 ? `Snapshots enregistrés : ${parts.join(', ')}` : 'Aucun changement';
      },
    );
    setSnapshotInputs({});
  };

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

  const filledCount = Object.values(snapshotInputs).filter((v) => v.trim() !== '').length;
  const orderedGroups = ['cash', 'regulated_savings', 'investments', 'crypto', 'liabilities', 'other'];

  return (
    <>
      <Panel title="Snapshots de fin de mois">
        <p className="panel-note">
          Saisis le solde réel de chaque compte à une date précise (typiquement le dernier jour du mois).
          Laisse vide les comptes que tu n'as pas encore vérifiés — seuls les champs remplis seront enregistrés.
          Re-saisir une même date écrase la valeur précédente.
        </p>
        <form className="form snapshot-batch-form" onSubmit={submitSnapshotBatch}>
          <label>Date du snapshot
            <input type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} required />
          </label>
          {accounts.length === 0 ? (
            <p className="empty">Crée d'abord un compte pour pouvoir saisir des snapshots.</p>
          ) : (
            <div className="table-wrap full">
              <table className="tx-table snapshot-batch-table">
                <thead>
                  <tr>
                    <th>Compte</th>
                    <th>Devise</th>
                    <th className="amount-cell">Solde estimé</th>
                    <th className="amount-cell">Nouveau solde réel</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedGroups.flatMap((group) => {
                    const groupAccounts = accountsByGroup.get(group);
                    if (!groupAccounts || groupAccounts.length === 0) return [];
                    return [
                      <tr key={`header-${group}`} className="snapshot-batch-group-header">
                        <td colSpan={4}>{accountGroupLabel(group)}</td>
                      </tr>,
                      ...groupAccounts.map((account) => {
                        const estimated = estimatedByAccount.get(account.id);
                        return (
                          <tr key={account.id}>
                            <td><strong>{account.name}</strong></td>
                            <td>{account.currency}</td>
                            <td className="amount-cell">
                              {estimated ? money(estimated.signed_balance, account.currency) : '—'}
                            </td>
                            <td className="amount-cell">
                              <input
                                type="number"
                                step="0.01"
                                inputMode="decimal"
                                placeholder={`en ${account.currency}`}
                                value={snapshotInputs[account.id] ?? ''}
                                onChange={(e) => setSnapshotInputs((current) => ({ ...current, [account.id]: e.target.value }))}
                                aria-label={`Solde réel pour ${account.name} en ${account.currency}`}
                              />
                            </td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
          <button className="primary" disabled={filledCount === 0}>
            <CalendarCheck size={16} /> Enregistrer {filledCount > 0 ? `(${filledCount})` : ''}
          </button>
        </form>
      </Panel>

      <section className="split" style={{ marginTop: 18 }}>
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
              {snapshots.slice(0, 20).map((s) => {
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
    </>
  );
}
