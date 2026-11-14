import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Category, RecurringTransaction, Transaction } from '@suzanne/shared';
import { api } from '../../lib/api';
import { money, txLabel } from '../../lib/format';
import { Modal } from '../Modal';
import type { Run } from '../../lib/run';
import { formatTxDate } from './txUtils';

export function RecurringLinkModal({ tx, userId, recurring, accountById, categoryById, run, onClose }: {
  tx: Transaction;
  userId: number;
  recurring: RecurringTransaction[];
  accountById: Map<number, Account>;
  categoryById: Map<number, Category>;
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const raw = Number(data.get('recurring_transaction_id'));
    const recurringId = Number.isFinite(raw) && raw > 0 ? raw : null;
    setBusy(true);
    const ok = await run(() => api.linkTransactionRecurring(userId, tx.id, {
      recurring_transaction_id: recurringId,
      sync_description: data.get('sync_description') === 'on',
      sync_amount: data.get('sync_amount') === 'on',
      sync_category_account: data.get('sync_category_account') === 'on',
    }), recurringId ? t('operations.transaction_linked_to_recurring') : t('operations.recurring_link_removed'));
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title={t('operations.link_to_recurring_entry')} onClose={onClose}>
      <form className="jr-form" onSubmit={submit}>
        <div className="jr-ref full">
          <span>{formatTxDate(tx.date)} · {txLabel(tx, categoryById)}</span>
        </div>
        <label className="full">{t('operations.recurring')}
          <select name="recurring_transaction_id" defaultValue={tx.recurring_transaction_id ?? ''}>
            <option value="">{t('operations.none_2')}</option>
            {recurring.filter((r) => r.type === tx.type || tx.type === 'transfer').map((r) => (
              <option key={r.id} value={r.id}>{r.description} - {money(r.amount, accountById.get(r.account_id ?? -1)?.currency ?? 'EUR')}</option>
            ))}
          </select>
        </label>
        <label className="jr-check full"><input type="checkbox" name="sync_category_account" defaultChecked /> {t('operations.sync_account_category_type')}</label>
        <label className="jr-check full"><input type="checkbox" name="sync_description" /> {t('operations.rename_like_recurring_entry')}</label>
        <label className="jr-check full"><input type="checkbox" name="sync_amount" /> {t('operations.replace_amount_with_recurring_one')}</label>
        <div className="jr-form-actions full">
          <span className="jr-spacer" />
          <button type="button" className="secondary" onClick={onClose}>{t('commun.cancel')}</button>
          <button className="primary" disabled={busy}>{t('operations.link')}</button>
        </div>
      </form>
    </Modal>
  );
}
