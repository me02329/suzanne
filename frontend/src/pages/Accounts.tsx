import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, ArchiveRestore, CalendarCheck, ChevronDown, ChevronUp, Landmark, LineChart, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
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
} from '@suzanne/shared';
import { api } from '../lib/api';
import { lastDayOfPreviousMonthIso, money, todayIso } from '../lib/format';
import { localeTag } from '../i18n';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { LimitPicker, useListLimit } from '../components/LimitPicker';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { Collapsible } from '../components/Collapsible';

import type { Run } from '../lib/run';

const ORDERED_GROUPS = ['cash', 'regulated_savings', 'investments', 'crypto', 'liabilities', 'other'];

export function Accounts({ userId, accounts, institutions, snapshots, institutionById, summary, run }: {
  userId: number;
  accounts: Account[];
  institutions: Institution[];
  snapshots: AccountSnapshot[];
  institutionById: Map<number, Institution>;
  summary: DashboardSummary | null;
  run: Run;
}) {
  const { t } = useTranslation();
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editingInstitution, setEditingInstitution] = useState<Institution | null>(null);
  const [snapshotDate, setSnapshotDate] = useState<string>(() => lastDayOfPreviousMonthIso());
  const [snapshotInputs, setSnapshotInputs] = useState<Record<number, string>>({});
  const [prefilling, setPrefilling] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = usePersistedState<boolean>('accounts_snapshots_open', false);
  const [accountOpen, setAccountOpen] = usePersistedState<boolean>('accounts_account_open', accounts.length === 0);
  const [institutionOpen, setInstitutionOpen] = usePersistedState<boolean>('accounts_institution_open', false);
  const snapshotsLimit = useListLimit(10);

  const accountsByGroup = useMemo(() => {
    const buckets = new Map<string, Account[]>();
    for (const account of accounts) {
      const group = accountTypeGroup(account.type);
      const list = buckets.get(group) ?? [];
      list.push(account);
      buckets.set(group, list);
    }
    for (const list of buckets.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return buckets;
  }, [accounts]);

  const accountsByInstitution = useMemo(() => {
    const buckets = new Map<number | null, Account[]>();
    for (const account of accounts) {
      const key = account.institution_id ?? null;
      const list = buckets.get(key) ?? [];
      list.push(account);
      buckets.set(key, list);
    }
    for (const list of buckets.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return buckets;
  }, [accounts]);

  const estimatedByAccount = useMemo(() => {
    return new Map((summary?.account_balances ?? []).map((row) => [row.account_id, row]));
  }, [summary]);
  const reportCurrency = summary?.currency ?? 'EUR';
  const unassignedBalance = summary?.unassigned_balance ?? 0;
  const hasUnassignedTransactions = (summary?.unassigned_count ?? 0) > 0 || unassignedBalance !== 0;

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
        if (created > 0) parts.push(t('{{n}} créés', { n: created }));
        if (updated > 0) parts.push(t('{{n}} mis à jour', { n: updated }));
        return parts.length > 0 ? t('Snapshots enregistrés : {{parts}}', { parts: parts.join(', ') }) : t('Aucun changement');
      },
    );
    setSnapshotInputs({});
  };

  // Pré-remplit chaque champ avec le dernier solde connu + delta des
  // transactions jusqu'à la date du snapshot (calcul côté backend, dans la
  // devise propre de chaque compte). L'utilisateur valide ou corrige.
  const prefillSnapshots = async () => {
    setPrefilling(true);
    try {
      const suggestions = await api.snapshotSuggestions(userId, snapshotDate);
      setSnapshotInputs((current) => {
        const next = { ...current };
        for (const s of suggestions) next[s.account_id] = String(s.suggested_balance);
        return next;
      });
    } finally {
      setPrefilling(false);
    }
  };

  const submitAccount = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      institution_id: (() => { const v = data.get('institution_id'); return v && Number(v) > 0 ? Number(v) : null; })(),
      name: String(data.get('name')),
      type: String(data.get('type')) as Account['type'],
      currency: String(data.get('currency') || 'EUR'),
      initial_balance: Number(data.get('initial_balance') || 0),
      initial_balance_date: String(data.get('initial_balance_date')),
    };
    if (editingAccount) {
      void run(() => api.updateAccount(userId, editingAccount.id, body), t('Compte modifié'));
      setEditingAccount(null);
    } else {
      void run(() => api.createAccount(userId, body), t('Compte ajouté'));
      form.reset();
    }
  };

  const submitInstitution = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => api.createInstitution(userId, { name: String(data.get('name')) }), t('Institution ajoutée'));
    form.reset();
  };

  const submitInstitutionEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingInstitution) return;
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    if (!name) return;
    void run(() => api.updateInstitution(userId, editingInstitution.id, { name }), t('Institution renommée'));
    setEditingInstitution(null);
  };

  // Réassignation rapide d'un compte à une autre institution (ou aucune).
  const reassignAccount = (account: Account, institutionId: number | null) => {
    if ((account.institution_id ?? null) === institutionId) return;
    void run(() => api.updateAccount(userId, account.id, { institution_id: institutionId }), t('Compte réassigné'));
  };

  const filledCount = Object.values(snapshotInputs).filter((v) => v.trim() !== '').length;
  const institutionOrder: Array<{ id: number | null; name: string }> = [
    ...institutions.map((i) => ({ id: i.id as number | null, name: i.name })),
    { id: null, name: t('Sans institution') },
  ];
  const hasUnassigned = (accountsByInstitution.get(null)?.length ?? 0) > 0 || hasUnassignedTransactions;

  return (
    <section className="stack">
      <div className={`collapsible-panel ${snapshotsOpen ? 'open' : ''}`}>
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setSnapshotsOpen(!snapshotsOpen)}
          aria-expanded={snapshotsOpen}
        >
          <span className="collapsible-title"><CalendarCheck size={16} /> {t('Saisir snapshots de fin de mois')}</span>
          {snapshotsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={snapshotsOpen} className="collapsible-body">
            <p className="panel-note">
              {t('Saisis le solde réel à une date précise. Laisse vide les comptes non vérifiés. Re-saisir la même date écrase la valeur précédente.')}
            </p>
            <form className="form snapshot-batch-form" onSubmit={submitSnapshotBatch}>
              <div className="snapshot-batch-controls">
                <label>{t('Date du snapshot')}
                  <input type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} required />
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void prefillSnapshots()}
                  disabled={prefilling || accounts.length === 0}
                  title={t('Remplir avec le dernier solde connu + transactions')}
                >
                  <Wand2 size={16} /> {prefilling ? t('Calcul…') : t('Pré-remplir')}
                </button>
              </div>
              {accounts.length === 0 ? (
                <p className="empty">{t('Crée d\'abord un compte pour saisir des snapshots.')}</p>
              ) : (
                <div className="table-wrap full">
                  <table className="tx-table snapshot-batch-table">
                    <thead>
                      <tr>
                        <th>{t('Compte')}</th>
                        <th>{t('Devise')}</th>
                        <th className="amount-cell">{t('Solde estimé')}</th>
                        <th className="amount-cell">{t('Nouveau solde réel')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ORDERED_GROUPS.flatMap((group) => {
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
                                  {estimated ? money(estimated.signed_balance, reportCurrency) : '—'}
                                </td>
                                <td className="amount-cell">
                                  <input
                                    type="number"
                                    step="0.01"
                                    inputMode="decimal"
                                    placeholder={t('en {{currency}}', { currency: account.currency })}
                                    value={snapshotInputs[account.id] ?? ''}
                                    onChange={(e) => setSnapshotInputs((current) => ({ ...current, [account.id]: e.target.value }))}
                                    aria-label={t('Solde réel pour {{name}} en {{currency}}', { name: account.name, currency: account.currency })}
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
                <CalendarCheck size={16} /> {t('Enregistrer')} {filledCount > 0 ? `(${filledCount})` : ''}
              </button>
            </form>
          </Collapsible>
      </div>

      <div className={`collapsible-panel ${accountOpen ? 'open' : ''}`}>
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setAccountOpen(!accountOpen)}
          aria-expanded={accountOpen}
        >
          <span className="collapsible-title"><Plus size={16} /> {t('Nouveau compte')}</span>
          {accountOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={accountOpen} className="collapsible-body">
            <form className="form form-inline" onSubmit={submitAccount} key={editingAccount?.id ?? 'new-account'}>
              <label className="grow">{t('Nom')}<input name="name" defaultValue={editingAccount?.name ?? ''} required /></label>
              <label>{t('Type')}
                <select name="type" defaultValue={editingAccount?.type ?? 'checking'}>
                  {ACCOUNT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>{t('Institution')}
                <select name="institution_id" defaultValue={editingAccount?.institution_id ?? ''}>
                  <option value="">{t('Aucune')}</option>
                  {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </label>
              <label>{t('Devise')}
                <select name="currency" defaultValue={editingAccount?.currency ?? 'EUR'} required>
                  {REPORT_CURRENCIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>{t('Solde initial')}<input name="initial_balance" type="number" step="0.01" defaultValue={editingAccount?.initial_balance ?? 0} /></label>
              <label>{t('Date initiale')}<input name="initial_balance_date" type="date" defaultValue={editingAccount?.initial_balance_date?.slice(0, 10) ?? todayIso()} required /></label>
              <button className="primary"><Landmark size={16} /> {editingAccount ? t('Enregistrer') : t('Ajouter')}</button>
              {editingAccount && <button type="button" className="secondary" onClick={() => setEditingAccount(null)}>{t('Annuler')}</button>}
            </form>
          </Collapsible>
      </div>

      <div className={`collapsible-panel ${institutionOpen ? 'open' : ''}`}>
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setInstitutionOpen(!institutionOpen)}
          aria-expanded={institutionOpen}
        >
          <span className="collapsible-title"><Plus size={16} /> {t('Nouvelle institution')}</span>
          {institutionOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={institutionOpen} className="collapsible-body">
            <form className="form form-inline" onSubmit={submitInstitution}>
              <label className="grow">{t('Nom')}<input name="name" required placeholder={t('Banque, broker, caisse...')} /></label>
              <button className="primary">{t('Ajouter')}</button>
            </form>
          </Collapsible>
      </div>

      <Panel title={t('Institutions et comptes')}>
        {accounts.length === 0 && institutions.length === 0 ? (
          <p className="empty">{t('Crée une institution et un compte pour commencer.')}</p>
        ) : (
          <div className="institution-list">
            {institutionOrder.map((institution) => {
              const accountsHere = accountsByInstitution.get(institution.id) ?? [];
              if (institution.id === null && !hasUnassigned) return null;
              // signed_balance is already converted to the report currency by
              // the backend, which produces a row for every account — the `?? 0`
              // is just a guard, never a native-currency value mixed into the sum.
              const total = accountsHere.reduce((sum, a) => {
                const est = estimatedByAccount.get(a.id);
                return sum + (est?.signed_balance ?? 0);
              }, institution.id === null ? unassignedBalance : 0);
              const showUnassignedTransactions = institution.id === null && hasUnassignedTransactions;
              return (
                <div className="institution-card" key={institution.id ?? 'none'}>
                  <div className="institution-card-header">
                    <div>
                      <strong title={institution.name}>{institution.name}</strong>
                      <span>{t(accountsHere.length > 1 ? '{{n}} comptes' : '{{n}} compte', { n: accountsHere.length })}</span>
                    </div>
                    <div className="institution-card-actions">
                      <span className="institution-total">{money(total, reportCurrency)}</span>
                      {institution.id !== null && (
                        <IconButton
                          label={t('Renommer l\'institution')}
                          tone="neutral"
                          icon={<Pencil size={14} />}
                          onClick={() => setEditingInstitution(institutions.find((i) => i.id === institution.id) ?? null)}
                        />
                      )}
                      {institution.id !== null && accountsHere.length === 0 && (
                        <IconButton
                          label={t('Supprimer l\'institution')}
                          icon={<Trash2 size={14} />}
                          confirm={t('Supprimer l\'institution « {{name}} » ?', { name: institution.name })}
                          onClick={() => void run(() => api.deleteInstitution(userId, institution.id as number), t('Institution supprimée'))}
                        />
                      )}
                    </div>
                  </div>
                  {accountsHere.length === 0 && !showUnassignedTransactions ? (
                    <p className="empty inline">{t('Aucun compte rattaché.')}</p>
                  ) : (
                    <ul className="institution-accounts">
                      {showUnassignedTransactions && (
                        <li>
                          <div className="account-line-main">
                            <strong>{t('Transactions hors compte')}</strong>
                            <span>{t('Revenus/dépenses historiques sans compte')}</span>
                          </div>
                          <div className="account-line-amount">
                            {money(unassignedBalance, reportCurrency)}
                          </div>
                          <div className="account-line-actions" />
                        </li>
                      )}
                      {accountsHere.map((account) => {
                        const estimated = estimatedByAccount.get(account.id);
                        return (
                          <li key={account.id} className={account.archived ? 'account-archived' : undefined}>
                            <div className="account-line-main">
                              <Link className="account-line-name" to={`/accounts/${account.id}`} title={account.name}>
                                {account.name}
                                {account.archived && <span className="badge-archived">{t('Clôturé')}</span>}
                              </Link>
                              <span>{accountTypeLabel(account.type)} · {account.currency}</span>
                            </div>
                            <div className="account-line-amount">
                              {money(estimated?.signed_balance ?? account.initial_balance, reportCurrency)}
                            </div>
                            <div className="account-line-actions">
                              <Link className="icon-button neutral" to={`/accounts/${account.id}`} aria-label={t('Voir la fiche de {{name}}', { name: account.name })} title={t('Voir la fiche')}><LineChart size={14} /></Link>
                              <select
                                className="reassign-select"
                                aria-label={t('Réassigner {{name}} à une institution', { name: account.name })}
                                title={t('Réassigner à…')}
                                value={account.institution_id ?? ''}
                                onChange={(e) => reassignAccount(account, e.target.value ? Number(e.target.value) : null)}
                              >
                                <option value="">{t('Sans institution')}</option>
                                {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                              </select>
                              <IconButton label={t('Modifier')} tone="neutral" icon={<Pencil size={14} />} onClick={() => { setEditingAccount(account); setAccountOpen(true); }} />
                              {account.archived ? (
                                <IconButton
                                  label={t('Rouvrir le compte')}
                                  tone="accent"
                                  icon={<ArchiveRestore size={14} />}
                                  onClick={() => void run(() => api.updateAccount(userId, account.id, { archived: false }), t('Compte rouvert'))}
                                />
                              ) : (
                                <IconButton
                                  label={t('Clôturer (archiver) le compte')}
                                  tone="neutral"
                                  icon={<Archive size={14} />}
                                  confirm={t('Clôturer le compte « {{name}} » ? Il est masqué des saisies mais son historique et son solde sont conservés. Réversible à tout moment.', { name: account.name })}
                                  onClick={() => void run(() => api.updateAccount(userId, account.id, { archived: true }), t('Compte clôturé'))}
                                />
                              )}
                              <IconButton label={t('Supprimer définitivement')} icon={<Trash2 size={14} />} confirm={t('Supprimer définitivement le compte « {{name}} » ? Ses transactions ne sont pas supprimées mais détachées (elles passent « sans compte »). Pour conserver un historique cohérent, préfère la clôture.', { name: account.name })} onClick={() => void run(() => api.deleteAccount(userId, account.id), t('Compte supprimé'))} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel
        title={t('Snapshots récents')}
        action={<LimitPicker limit={snapshotsLimit.limit} onChange={snapshotsLimit.setLimit} total={snapshots.length} />}
      >
        <DataTable scroll empty={snapshots.length === 0 ? t('Aucun snapshot.') : null}>
          <thead><tr><th>{t('Date')}</th><th>{t('Compte')}</th><th className="amount-cell">{t('Solde')}</th><th className="actions-cell">{t('Actions')}</th></tr></thead>
          <tbody>
            {snapshotsLimit.clamp(snapshots).map((s) => {
              const account = accounts.find((a) => a.id === s.account_id);
              return (
                <tr key={s.id}>
                  <td>{new Date(s.date).toLocaleDateString(localeTag())}</td>
                  <td>{account?.name ?? t('Compte')}</td>
                  <td className="amount-cell">{money(s.balance, account?.currency ?? 'EUR')}</td>
                  <td className="actions-cell"><IconButton label={t('Supprimer')} confirm={t('Supprimer ce snapshot ?')} onClick={() => void run(() => api.deleteSnapshot(userId, s.id), t('Snapshot supprimé'))} /></td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>

      {editingAccount && !accountOpen && (
        <Modal title={t('Modifier {{name}}', { name: editingAccount.name })} onClose={() => setEditingAccount(null)}>
          <form className="form" onSubmit={submitAccount} key={`modal-${editingAccount.id}`}>
            <label>{t('Nom')}<input name="name" defaultValue={editingAccount.name} required /></label>
            <label>{t('Type')}<select name="type" defaultValue={editingAccount.type}>{ACCOUNT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <label>{t('Institution')}<select name="institution_id" defaultValue={editingAccount.institution_id ?? ''}><option value="">{t('Aucune')}</option>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
            <label>{t('Devise')}<select name="currency" defaultValue={editingAccount.currency} required>{REPORT_CURRENCIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <label>{t('Solde initial')}<input name="initial_balance" type="number" step="0.01" defaultValue={editingAccount.initial_balance} /></label>
            <label>{t('Date initiale')}<input name="initial_balance_date" type="date" defaultValue={editingAccount.initial_balance_date.slice(0, 10)} required /></label>
            <button className="primary">{t('Enregistrer')}</button>
            <button type="button" className="secondary" onClick={() => setEditingAccount(null)}>{t('Annuler')}</button>
          </form>
        </Modal>
      )}

      {editingInstitution && (
        <Modal title={t('Renommer « {{name}} »', { name: editingInstitution.name })} onClose={() => setEditingInstitution(null)}>
          <form className="form" onSubmit={submitInstitutionEdit} key={`inst-${editingInstitution.id}`}>
            <label>{t('Nom')}<input name="name" defaultValue={editingInstitution.name} required maxLength={120} autoFocus /></label>
            <button className="primary">{t('Enregistrer')}</button>
            <button type="button" className="secondary" onClick={() => setEditingInstitution(null)}>{t('Annuler')}</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
