import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, CalendarCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  accountGroupLabel,
  accountGroupOf,
  accountTypeLabel,
  type Account,
  type AccountSnapshot,
  type DashboardSummary,
  type Institution,
} from '@suzanne/shared';
import { api } from '../lib/api';
import { accountsApi, type AccountWithInvestment } from '../lib/api-accounts';
import { money } from '../lib/format';
import { formatDateFr } from '../lib/pea';
import { usePersistedState } from '../lib/storage';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/accounts/RowMenu';
import { AccountFormModal } from '../components/accounts/AccountFormModal';
import { SnapshotBatchModal } from '../components/accounts/SnapshotBatchModal';
import type { Run } from '../lib/run';
import '../styles/pages/accounts.css';
import { useTranslation } from 'react-i18next';

const ORDERED_GROUPS = ['cash', 'regulated_savings', 'investments', 'crypto', 'liabilities', 'other', 'business'];

interface Group { key: string; title: string; accounts: Account[] }

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
  const [groupBy, setGroupBy] = usePersistedState<'type' | 'institution'>('accounts_group_by', 'type');
  const [formFor, setFormFor] = useState<AccountWithInvestment | 'new' | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [blocked, setBlocked] = useState<{ account: Account; message: string } | null>(null);

  const reportCurrency = summary?.currency ?? 'EUR';
  const balanceById = useMemo(() => new Map((summary?.account_balances ?? []).map((r) => [r.account_id, r.signed_balance])), [summary]);
  const balanceOf = (a: Account) => balanceById.get(a.id) ?? a.initial_balance;
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const unassignedCount = summary?.unassigned_count ?? 0;
  const unassignedBalance = summary?.unassigned_balance ?? 0;

  const groups: Group[] = useMemo(() => {
    const sorted = [...active].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    if (groupBy === 'institution') {
      const list: Group[] = institutions
        .map((i) => ({ key: `i${i.id}`, title: i.name, accounts: sorted.filter((a) => a.institution_id === i.id) }))
        .filter((g) => g.accounts.length > 0)
        .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
      const none = sorted.filter((a) => a.institution_id == null || !institutionById.has(a.institution_id));
      if (none.length > 0) list.push({ key: 'none', title: 'Sans institution', accounts: none });
      return list;
    }
    return ORDERED_GROUPS
      .map((g) => ({ key: g, title: accountGroupLabel(g), accounts: sorted.filter((a) => accountGroupOf(a) === g) }))
      .filter((g) => g.accounts.length > 0);
  }, [accounts, institutions, institutionById, groupBy]);

  const archive = (account: Account, value: boolean) => void run(
    () => api.updateAccount(userId, account.id, { archived: value }),
    value ? `${account.name} archivé` : `${account.name} rouvert`,
    { undo: () => api.updateAccount(userId, account.id, { archived: !value }) },
  );

  // Suppression : le serveur refuse (409) un compte qui porte des opérations.
  // On tente d'abord l'appel ; en cas de refus on propose l'archivage, sinon
  // on passe par run() pour recharger et offrir « Annuler » (recréation).
  const remove = async (account: Account) => {
    try {
      await api.deleteAccount(userId, account.id);
    } catch (e) {
      const message = (e as Error).message;
      if (/archiv/i.test(message) || /409/.test(message)) { setBlocked({ account, message }); return; }
      void run(() => Promise.reject(e));
      return;
    }
    const a = account as AccountWithInvestment;
    void run(() => Promise.resolve(), `${account.name} supprimé`, {
      undo: () => accountsApi.create(userId, {
        name: a.name, type: a.type, currency: a.currency, institution_id: a.institution_id,
        initial_balance: a.initial_balance, initial_balance_date: a.initial_balance_date.slice(0, 10),
        orders_affect_cash: a.orders_affect_cash, fiscal_start_date: a.fiscal_start_date?.slice(0, 10) ?? null, professional: a.professional ?? false,
      }),
    });
  };

  const row = (account: Account) => {
    const balance = balanceOf(account);
    const institution = account.institution_id != null ? institutionById.get(account.institution_id) : null;
    const meta = [accountTypeLabel(account.type), groupBy === 'type' ? institution?.name : null, account.currency !== reportCurrency ? account.currency : null]
      .filter(Boolean).join(' · ');
    return (
      <li key={account.id} className={`acc-row${account.archived ? ' is-archived' : ''}`}>
        <Link className="acc-row-main" to={`/accounts/${account.id}`}>
          <span className="acc-row-name">{account.name}</span>
          <span className="acc-row-meta">{meta}</span>
        </Link>
        <Link to={`/accounts/${account.id}`} className={`acc-row-amount num${balance < 0 ? ' expense' : ''}`} tabIndex={-1}>
          {money(balance, reportCurrency)}
        </Link>
        <div className="acc-row-actions">
          <button type="button" className="row-btn" aria-label={`Modifier ${account.name}`} title={t('comptes.accounts.edit')} onClick={() => setFormFor(account as AccountWithInvestment)}>
            <Pencil size={16} />
          </button>
          <RowMenu
            label={`Plus d'actions pour ${account.name}`}
            items={[
              account.archived
                ? { label: 'Rouvrir', icon: <ArchiveRestore size={16} />, onClick: () => archive(account, false) }
                : { label: 'Archiver', icon: <Archive size={16} />, onClick: () => archive(account, true) },
              { label: 'Supprimer', icon: <Trash2 size={16} />, danger: true, onClick: () => void remove(account) },
            ]}
          />
        </div>
      </li>
    );
  };

  const recentSnapshots = [...snapshots].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const netWorth = summary?.net_worth ?? active.reduce((s, a) => s + balanceOf(a), 0);

  return (
    <section className="acc-page">
      <header className="acc-hero">
        <div className="acc-hero-main">
          <span className="acc-kicker">{t('comptes.accounts.net_worth')}</span>
          <strong className={`acc-hero-value num${netWorth < 0 ? ' expense' : ''}`}>{money(netWorth, reportCurrency)}</strong>
          {summary && (
            <span className="acc-hero-sub">
              <span>{t('comptes.accounts.assets')} <b className="num">{money(summary.balance_assets, reportCurrency)}</b></span>
              <span>{t('comptes.accounts.liabilities')} <b className="num">{money(summary.balance_liabilities, reportCurrency)}</b></span>
              <span>{active.length}  {t('comptes.accounts.account')}{active.length > 1 ? 's' : ''}</span>
            </span>
          )}
        </div>
        <div className="acc-hero-actions">
          <button type="button" className="secondary" onClick={() => setBatchOpen(true)} disabled={active.length === 0}>
            <CalendarCheck size={16} />  {t('comptes.accounts.enter_month_end_balances')}
          </button>
          <button type="button" className="primary accent" onClick={() => setFormFor('new')}>
            <Plus size={16} />  {t('comptes.accounts.add_account')}
          </button>
        </div>
      </header>

      {accounts.length === 0 ? (
        <div className="acc-empty">
          <p>{t('comptes.accounts.no_accounts_yet')}</p>
          <p className="acc-muted">{t('comptes.accounts.add_your_current_account_savings')}</p>
        </div>
      ) : (
        <>
          <div className="acc-toolbar" role="group" aria-label={t('comptes.accounts.group_accounts')}>
            <span className="acc-muted">{t('comptes.accounts.group_by')}</span>
            <div className="acc-seg">
              <button type="button" aria-pressed={groupBy === 'type'} onClick={() => setGroupBy('type')}>{t('comptes.accounts.type')}</button>
              <button type="button" aria-pressed={groupBy === 'institution'} onClick={() => setGroupBy('institution')}>{t('comptes.accounts.institution')}</button>
            </div>
          </div>

          <div className="acc-groups">
            {groups.map((group) => {
              const total = group.accounts.reduce((s, a) => s + balanceOf(a), 0);
              return (
                <section className="acc-group" key={group.key}>
                  <header className="acc-group-head">
                    <h2>{group.title}</h2>
                    <span className={`num${total < 0 ? ' expense' : ''}`}>{money(total, reportCurrency)}</span>
                  </header>
                  <ul className="acc-list">{group.accounts.map(row)}</ul>
                </section>
              );
            })}
            {unassignedCount > 0 && (
              <section className="acc-group">
                <header className="acc-group-head">
                  <h2>{t('comptes.accounts.no_account')}</h2>
                  <span className="num">{money(unassignedBalance, reportCurrency)}</span>
                </header>
                <p className="acc-muted acc-pad">{unassignedCount}  {t('comptes.accounts.transaction')}{unassignedCount > 1 ? 's' : ''}  {t('comptes.accounts.without_account_counted')}{unassignedCount > 1 ? 's' : ''}  {t('comptes.accounts.as_cash_assign_them_from')}</p>
              </section>
            )}
          </div>

          {archived.length > 0 && (
            <details className="acc-fold">
              <summary>{t('comptes.accounts.archived_accounts')} <span className="acc-count">{archived.length}</span></summary>
              <ul className="acc-list">{archived.map(row)}</ul>
            </details>
          )}

          {recentSnapshots.length > 0 && (
            <details className="acc-fold">
              <summary>{t('comptes.accounts.recent_statements')} <span className="acc-count">{snapshots.length}</span></summary>
              <ul className="acc-list">
                {recentSnapshots.map((s) => {
                  const account = accountById.get(s.account_id);
                  return (
                    <li key={s.id} className="acc-row">
                      <div className="acc-row-main">
                        <span className="acc-row-name">{account?.name ?? 'Compte supprimé'}</span>
                        <span className="acc-row-meta">{formatDateFr(s.date)}</span>
                      </div>
                      <span className="acc-row-amount num">{money(s.balance, account?.currency ?? 'EUR')}</span>
                      <div className="acc-row-actions">
                        <button
                          type="button"
                          className="row-btn"
                          aria-label={t('comptes.accounts.delete_this_statement')}
                          title={t('comptes.accounts.delete')}
                          onClick={() => void run(
                            () => api.deleteSnapshot(userId, s.id),
                            'Relevé supprimé',
                            { undo: () => api.setSnapshot(userId, { account_id: s.account_id, date: s.date.slice(0, 10), balance: s.balance }) },
                          )}
                        ><Trash2 size={16} /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}

      {formFor && (
        <AccountFormModal
          userId={userId}
          account={formFor === 'new' ? null : formFor}
          accounts={accounts}
          institutions={institutions}
          run={run}
          onClose={() => setFormFor(null)}
        />
      )}
      {batchOpen && <SnapshotBatchModal userId={userId} accounts={accounts} summary={summary} run={run} onClose={() => setBatchOpen(false)} />}
      {blocked && (
        <Modal title={t('comptes.accounts.cannot_delete')} onClose={() => setBlocked(null)}>
          <p className="acc-blocked sheet-ok">{blocked.message}</p>
          <p className="acc-muted">{t('comptes.accounts.once_archived_account_disappears_from')}</p>
          <div className="acc-form-actions">
            <button type="button" className="secondary" onClick={() => setBlocked(null)}>{t('comptes.accounts.cancel')}</button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                const target = blocked.account;
                void run(
                  () => api.updateAccount(userId, target.id, { archived: true }),
                  `${target.name} archivé`,
                  { undo: () => api.updateAccount(userId, target.id, { archived: false }) },
                ).then((ok) => { if (ok) setBlocked(null); });
              }}
            ><Archive size={16} />  {t('comptes.accounts.archive')}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
