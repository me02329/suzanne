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

  const setCleared = (cleared: boolean) => {
    void run(
      () => api.bulkUpdateTransactions(userId, { ids, cleared }),
      (result) => t(cleared ? '{{n}} transactions pointées' : '{{n}} transactions dépointées', { n: (result as { updated: number }).updated }),
    ).then((ok) => { if (ok) clear(); });
  };

  const addTag = (tagId: number) => {
    const name = tags.find((tag) => tag.id === tagId)?.name ?? 'tag';
    void run(
      () => api.bulkUpdateTransactions(userId, { ids, add_tag_id: tagId }),
      (result) => t('{{n}} transactions taguées « {{name}} »', { n: (result as { updated: number }).updated, name }),
    ).then((ok) => { if (ok) clear(); });
  };

  // Suppression douce (corbeille) : « Annuler » dans le toast restaure tout.
  const remove = () => {
    void run(
      () => api.bulkDeleteTransactions(userId, ids),
      (result) => t('{{n}} transactions déplacées vers la corbeille', { n: (result as { deleted: number }).deleted }),
      { undo: () => Promise.all(ids.map((id) => api.restoreTransaction(userId, id))) },
    ).then((ok) => { if (ok) clear(); });
  };

  return (
    <div className="jr-bulk" role="region" aria-label={t('Actions sur la sélection')}>
      <strong>{t(count > 1 ? '{{n}} sélectionnées' : '{{n}} sélectionnée', { n: count })}</strong>
      <button type="button" className="secondary" onClick={onEdit}>{t('Modifier')}</button>
      {onRefund && canRefund && (
        <button type="button" className="secondary" onClick={onRefund} title={t('Un revenu peut rembourser plusieurs dépenses, et une dépense être remboursée par plusieurs revenus')}>
          {nIncome === 0 ? t('Rembourser') : nExpense === 0 ? t('Lier à une dépense') : t('Lier le remboursement')}
        </button>
      )}
      <button type="button" className="secondary" onClick={() => setCleared(true)}>{t('Pointer')}</button>
      <button type="button" className="secondary" onClick={() => setCleared(false)}>{t('Dépointer')}</button>
      {tags.length > 0 && (
        <select value="" aria-label={t('Ajouter un tag à la sélection')} onChange={(e) => { if (e.target.value) addTag(Number(e.target.value)); }}>
          <option value="">{t('Ajouter un tag…')}</option>
          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
      )}
      <button type="button" className="secondary jr-danger" onClick={remove}>{t('Supprimer')}</button>
      <button type="button" className="icon-ghost" onClick={clear} aria-label={t('Désélectionner')} title={t('Désélectionner')}><X size={18} /></button>
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
      (result) => t('{{n}} transactions modifiées', { n: (result as { updated: number }).updated }),
    );
    setBusy(false);
    if (ok) { selection.clear(); onClose(); }
  };

  return (
    <Modal title={t(count > 1 ? 'Modifier {{n}} transactions' : 'Modifier {{n}} transaction', { n: count })} onClose={onClose}>
      <form className="jr-form" onSubmit={submit}>
        <label className="jr-check full"><input type="checkbox" checked={applyAccount} onChange={(e) => setApplyAccount(e.target.checked)} /> {t('Changer le compte')}</label>
        <label className="full">
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setApplyAccount(true); }} aria-label={t('Compte')}>
            <option value="">{t('Sans compte')}</option>
            {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="jr-check full"><input type="checkbox" checked={applyCategory} onChange={(e) => setApplyCategory(e.target.checked)} /> {t('Changer la catégorie')}</label>
        <label className="full">
          <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setApplyCategory(true); }} aria-label={t('Catégorie')}>
            <option value="">{t('Sans catégorie')}</option>
            <optgroup label={t('Dépenses')}>
              {categories.filter((c) => c.type === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            <optgroup label={t('Revenus')}>
              {categories.filter((c) => c.type === 'income').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          </select>
        </label>
        <div className="jr-form-actions full">
          <span className="jr-spacer" />
          <button type="button" className="secondary" onClick={onClose}>{t('Annuler')}</button>
          <button className="primary" disabled={busy || (!applyAccount && !applyCategory)}>{t('Appliquer')}</button>
        </div>
      </form>
    </Modal>
  );
}
