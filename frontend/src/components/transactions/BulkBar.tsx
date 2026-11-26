import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { Account, Category, Tag } from '@suzanne/shared';
import { api } from '../../lib/api';
import { pickableAccounts } from '../../lib/account';
import { Modal } from '../Modal';
import type { Run } from '../../lib/run';
import type { SelectionState } from './useSelection';

// Barre d'actions groupées, affichée tant qu'une sélection existe.
export function BulkBar({ selection, userId, tags, run, onEdit, onRefund }: {
  selection: SelectionState;
  userId: number;
  tags: Tag[];
  run: Run;
  onEdit: () => void;
  /** Lier les remboursements de la sélection (dépenses ↔ revenus). */
  onRefund?: () => void;
}) {
  const { t } = useTranslation();
  const { count, selected, clear } = selection;
  if (count === 0) return null;
  const ids = selected.map((tx) => tx.id);
  // Remboursement possible : pas de transfert, et un seul revenu ou une seule
  // dépense d'un côté (1 ↔ N).
  const nIncome = selected.filter((tx) => tx.type === 'income').length;
  const nExpense = selected.filter((tx) => tx.type === 'expense').length;
  const canRefund = nIncome + nExpense === count && !(nIncome > 1 && nExpense > 1);
  // Deux côtés d'un même virement (une sortie, une entrée, deux comptes) : à relier.
  const outTx = selected.find((tx) => tx.type === 'expense');
  const inTx = selected.find((tx) => tx.type === 'income');
  const canTransfer = count === 2 && outTx != null && inTx != null && outTx.account_id != null && inTx.account_id != null && outTx.account_id !== inTx.account_id
    && (outTx.splits ?? []).length === 0 && (inTx.splits ?? []).length === 0;
  const linkTransfer = () => {
    if (!outTx || !inTx) return;
    void run(() => api.linkTransferPair(userId, outTx.id, inTx.id), t('operations.review.transfer_linked')).then((ok) => { if (ok) clear(); });
  };

  const setCleared = (cleared: boolean) => {
    void run(
      () => api.bulkUpdateTransactions(userId, { ids, cleared }),
      (result) => t(cleared ? 'operations.n_transactions_cleared' : 'operations.n_transactions_uncleared', { n: (result as { updated: number }).updated }),
    ).then((ok) => { if (ok) clear(); });
  };

  const addTag = (tagId: number) => {
    const name = tags.find((tag) => tag.id === tagId)?.name ?? 'tag';
    void run(
      () => api.bulkUpdateTransactions(userId, { ids, add_tag_id: tagId }),
      (result) => t('operations.n_transactions_tagged_name', { n: (result as { updated: number }).updated, name }),
    ).then((ok) => { if (ok) clear(); });
  };

  // Suppression douce (corbeille) : « Annuler » dans le toast restaure tout.
  const remove = () => {
    void run(
      () => api.bulkDeleteTransactions(userId, ids),
      (result) => t('operations.n_transactions_moved_to_trash', { n: (result as { deleted: number }).deleted }),
      { undo: () => Promise.all(ids.map((id) => api.restoreTransaction(userId, id))) },
    ).then((ok) => { if (ok) clear(); });
  };

  return (
    <div className="jr-bulk" role="region" aria-label={t('operations.actions_on_selection')}>
      <strong>{t(count > 1 ? 'operations.n_selected_3' : 'operations.n_selected_2', { n: count })}</strong>
      <button type="button" className="secondary" onClick={onEdit}>{t('operations.edit')}</button>
      {onRefund && canRefund && (
        <button type="button" className="secondary" onClick={onRefund} title={t('operations.one_income_can_refund_several')}>
          {nIncome === 0 ? t('operations.refund_2') : nExpense === 0 ? t('operations.link_to_expense') : t('operations.link_refund')}
        </button>
      )}
      {canTransfer && (
        <button type="button" className="secondary" onClick={linkTransfer} title={t('operations.review.link_transfer_hint')}>{t('operations.review.link_transfer')}</button>
      )}
      <button type="button" className="secondary" onClick={() => setCleared(true)}>{t('operations.clear_2')}</button>
      <button type="button" className="secondary" onClick={() => setCleared(false)}>{t('operations.unclear')}</button>
      {tags.length > 0 && (
        <select value="" aria-label={t('operations.add_tag_to_selection')} onChange={(e) => { if (e.target.value) addTag(Number(e.target.value)); }}>
          <option value="">{t('operations.add_tag')}</option>
          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
      )}
      <button type="button" className="secondary jr-danger" onClick={remove}>{t('operations.delete')}</button>
      <button type="button" className="icon-ghost" onClick={clear} aria-label={t('operations.deselect')} title={t('operations.deselect')}><X size={18} /></button>
    </div>
  );
}

export function BulkEditModal({ selection, userId, accounts, categories, run, onClose }: {
  selection: SelectionState;
  userId: number;
  accounts: Account[];
  categories: Category[];
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [applyAccount, setApplyAccount] = useState(false);
  const [applyCategory, setApplyCategory] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const count = selection.count;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!applyAccount && !applyCategory) return;
    const ids = selection.selected.map((tx) => tx.id);
    setBusy(true);
    const ok = await run(
      () => api.bulkUpdateTransactions(userId, {
        ids,
        ...(applyAccount ? { account_id: accountId ? Number(accountId) : null } : {}),
        ...(applyCategory ? { category_id: categoryId ? Number(categoryId) : null } : {}),
      }),
      (result) => t('operations.n_transactions_updated', { n: (result as { updated: number }).updated }),
    );
    setBusy(false);
    if (ok) { selection.clear(); onClose(); }
  };

  return (
    <Modal title={t(count > 1 ? 'operations.edit_n_transactions' : 'operations.edit_n_transaction', { n: count })} onClose={onClose}>
      <form className="jr-form" onSubmit={submit}>
        <label className="jr-check full"><input type="checkbox" checked={applyAccount} onChange={(e) => setApplyAccount(e.target.checked)} /> {t('operations.change_account')}</label>
        <label className="full">
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setApplyAccount(true); }} aria-label={t('operations.account')}>
            <option value="">{t('operations.no_account')}</option>
            {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="jr-check full"><input type="checkbox" checked={applyCategory} onChange={(e) => setApplyCategory(e.target.checked)} /> {t('operations.change_category')}</label>
        <label className="full">
          <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setApplyCategory(true); }} aria-label={t('commun.category')}>
            <option value="">{t('operations.no_category')}</option>
            <optgroup label={t('commun.expenses')}>
              {categories.filter((c) => c.type === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            <optgroup label={t('commun.income')}>
              {categories.filter((c) => c.type === 'income').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          </select>
        </label>
        <div className="jr-form-actions full">
          <span className="jr-spacer" />
          <button type="button" className="secondary" onClick={onClose}>{t('commun.cancel')}</button>
          <button className="primary" disabled={busy || (!applyAccount && !applyCategory)}>{t('operations.apply')}</button>
        </div>
      </form>
    </Modal>
  );
}
