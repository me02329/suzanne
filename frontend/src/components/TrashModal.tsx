import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { Category, Transaction } from '@suzanne/shared';
import { api } from '../lib/api';
import { money, txLabel } from '../lib/format';
import { formatTxDate } from './transactions/txUtils';
import { DataTable } from './DataTable';
import { IconButton } from './IconButton';
import i18n from '../i18n';
import { Modal } from './Modal';
import type { Run } from '../lib/run';
import { useTranslation } from 'react-i18next';

// Corbeille : transactions soft-deleted, restaurables ou purgeables. La liste
// est rechargée localement après chaque action (le reload global ne la couvre pas).
export function TrashModal({ userId, categoryById, run, onClose }: {
  userId: number;
  categoryById: Map<number, Category>;
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Transaction[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.trashedTransactions(userId)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [userId, version]);

  const restore = (t: Transaction) => {
    void run(() => api.restoreTransaction(userId, t.id), 'Transaction restaurée').then((ok) => { if (ok) setVersion((v) => v + 1); });
  };
  const purge = (t: Transaction) => {
    void run(() => api.purgeTransaction(userId, t.id), 'Transaction supprimée définitivement').then((ok) => { if (ok) setVersion((v) => v + 1); });
  };

  return (
    <Modal title={t('operations.trash_modal.trash')} onClose={onClose} wide>
      <p className="panel-note">{t('operations.trash_modal.deleted_transactions_are_kept_here')}</p>
      {items == null ? (
        <p className="empty"><Loader2 className="spin-icon" size={16} />  {t('operations.trash_modal.loading')}</p>
      ) : (
        <DataTable scroll empty={items.length === 0 ? 'La corbeille est vide.' : null}>
          <thead><tr><th>{t('operations.trash_modal.date')}</th><th>{t('operations.trash_modal.label')}</th><th className="amount-cell">{t('operations.trash_modal.amount')}</th><th className="actions-cell">{t('operations.trash_modal.actions')}</th></tr></thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td data-label={i18n.t('operations.trash_modal.date')}>{formatTxDate(t.date)}</td>
                <td data-label={i18n.t('operations.trash_modal.label')}>{txLabel(t, categoryById)}</td>
                <td className={`amount-cell ${t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer'}`} data-label={i18n.t('operations.trash_modal.amount')}>
                  {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}{money(Math.abs(t.amount))}
                </td>
                <td className="actions-cell">
                  <IconButton label={i18n.t('operations.trash_modal.restore')} tone="accent" icon={<RotateCcw size={16} />} onClick={() => restore(t)} />
                  <IconButton label={i18n.t('operations.trash_modal.delete_permanently')} confirm={i18n.t('operations.trash_modal.delete_permanently_this_cannot_be')} icon={<Trash2 size={16} />} onClick={() => purge(t)} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <button type="button" className="secondary" onClick={onClose}>{t('operations.trash_modal.close')}</button>
    </Modal>
  );
}
