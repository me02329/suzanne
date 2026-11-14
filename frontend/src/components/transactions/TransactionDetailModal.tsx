import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, Paperclip, Pencil } from 'lucide-react';
import type { Account, BankDataEntry, Category, Transaction } from '@suzanne/shared';
import { http } from '../../lib/api';
import { money } from '../../lib/format';
import { Modal } from '../Modal';
import { formatTxDate } from './txUtils';
import '../../styles/components/tx-detail.css';

// Fiche d'une opération : tout ce que Suzanne sait d'elle. Les opérations
// synchronisées avec la banque ont en plus les données bancaires (libellé
// complet, dates, références, contrepartie) ; les anciennes en ont moins.
// Clés écrites en toutes lettres (vérifiées par i18n:check).
const TYPE_KEYS: Record<string, string> = {
  expense: 'operations.detail.type_expense',
  income: 'operations.detail.type_income',
  transfer: 'operations.detail.type_transfer',
  trade: 'operations.detail.type_trade',
  adjustment: 'operations.detail.type_adjustment',
};

export function TransactionDetailModal({ userId, transactionId, categoryById, accountById, onEdit, onAttachments, onGoTo, onClose }: {
  userId: number;
  transactionId: number;
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  onEdit: (tx: Transaction) => void;
  onAttachments: (tx: Transaction) => void;
  onGoTo: (id: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tx, setTx] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    http<Transaction>(`/users/${userId}/transactions/${transactionId}`)
      .then((row) => { if (!cancelled) setTx(row); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [userId, transactionId]);

  if (!tx) {
    return (
      <Modal title={t('operations.detail.title')} onClose={onClose}>
        <p className="muted">{error ?? t('operations.detail.loading')}</p>
      </Modal>
    );
  }

  const account = accountById.get(tx.account_id ?? -1);
  const currency = account?.currency ?? 'EUR';
  const accountName = (id: number | null | undefined) => (id != null ? accountById.get(id)?.name ?? `#${id}` : t('operations.detail.no_account'));
  const lines = tx.lines ?? [];
  const bankData = (tx.bank_data ?? []) as BankDataEntry[];
  const origin = tx.import_fingerprint?.startsWith('eb:') ? 'sync' : tx.import_fingerprint ? 'import' : 'manual';
  const signed = tx.type === 'income' ? tx.amount : tx.type === 'expense' ? -tx.amount : tx.amount;
  const cardDate = /\bCARTE (\d{2})\/(\d{2})\/(\d{2})\b/i.exec(tx.description ?? '');
  const purchaseDate = cardDate ? `20${cardDate[3]}-${cardDate[2]}-${cardDate[1]}` : null;
  const professional = tx.type !== 'transfer' && Boolean(account?.professional);
  const notes = lines.map((l) => l.note).filter((n): n is string => Boolean(n));

  return (
    <Modal
      title={t('operations.detail.title')}
      onClose={onClose}
      wide
      footer={(
        <div className="txd-actions">
          <button type="button" className="secondary" onClick={() => onAttachments(tx)}><Paperclip size={15} /> {t('operations.detail.attachments')}</button>
          <button type="button" className="primary" onClick={() => onEdit(tx)}><Pencil size={15} /> {t('operations.detail.edit')}</button>
        </div>
      )}
    >
      <div className="txd">
        <header className="txd-head">
          <div>
            <p className="txd-label">{tx.description || t('operations.detail.no_label')}</p>
            <p className="muted">
              {formatTxDate(tx.date)} · {t(TYPE_KEYS[tx.type] ?? 'operations.detail.type_expense')}
              {professional && <span className="jr-badge jr-badge-pro">{t('operations.pro_badge')}</span>}
            </p>
          </div>
          <strong className={`txd-amount num${tx.type === 'income' ? ' income' : tx.type === 'expense' ? ' expense' : ''}`}>
            {tx.type === 'transfer' ? '⇄ ' : signed > 0 ? '+' : '−'}{money(Math.abs(signed), currency)}
          </strong>
        </header>

        <Section title={t('operations.detail.section_operation')}>
          {tx.type === 'transfer'
            ? <Row label={t('operations.detail.accounts')}>{accountName(tx.account_id)} → {accountName(tx.to_account_id)}</Row>
            : <Row label={t('operations.detail.account')}>{accountName(tx.account_id)}</Row>}
          {lines.length > 1 && tx.type !== 'transfer' ? (
            <Row label={t('operations.detail.split')}>
              <ul className="txd-lines">
                {lines.map((l) => (
                  <li key={l.id}>
                    <span>{l.category_id != null ? categoryById.get(l.category_id)?.name ?? '?' : t('operations.detail.uncategorized')}</span>
                    <span className="num">{money(l.amount, currency)}</span>
                    {l.note && <small className="muted">{l.note}</small>}
                  </li>
                ))}
              </ul>
            </Row>
          ) : tx.type !== 'transfer' && (
            <Row label={t('operations.detail.category')}>{tx.category_id != null ? categoryById.get(tx.category_id)?.name ?? '?' : t('operations.detail.uncategorized')}</Row>
          )}
          {purchaseDate && purchaseDate !== tx.date.slice(0, 10) && <Row label={t('operations.detail.purchase_date')}>{formatTxDate(purchaseDate)}</Row>}
          {tx.tags.length > 0 && <Row label={t('operations.detail.tags')}>{tx.tags.map((g) => g.name).join(', ')}</Row>}
          <Row label={t('operations.detail.cleared')}>{tx.cleared ? t('operations.detail.yes') : t('operations.detail.no')}</Row>
          {tx.recurring_transaction_id != null && <Row label={t('operations.detail.recurring')}>{t('operations.detail.recurring_linked')}</Row>}
          {(tx.refund_allocations ?? []).length > 0 && (
            <Row label={t('operations.detail.refunds')}>
              {tx.refund_allocations.map((a) => (
                <button key={a.expense_transaction_id} type="button" className="link-button" onClick={() => onGoTo(a.expense_transaction_id)}>
                  {a.expense_transaction?.description ?? `#${a.expense_transaction_id}`} ({money(a.amount, currency)})
                </button>
              ))}
            </Row>
          )}
          {(tx.refunded_by ?? []).length > 0 && (
            <Row label={t('operations.detail.refunded_by')}>
              {tx.refunded_by!.map((r) => (
                <button key={r.id} type="button" className="link-button" onClick={() => onGoTo(r.id)}>
                  {formatTxDate(r.date)} ({money(r.amount, currency)})
                </button>
              ))}
            </Row>
          )}
          {notes.length > 0 && lines.length <= 1 && <Row label={t('operations.detail.note')}><span className="txd-pre">{notes.join('\n')}</span></Row>}
        </Section>

        {bankData.map((b, i) => (
          <Section key={i} title={<><Landmark size={15} aria-hidden /> {t('operations.detail.section_bank', { bank: b.bank })}{bankData.length > 1 ? ` · ${accountName(b.account_id)}` : ''}</>}>
            {b.remittance_information && <Row label={t('operations.detail.full_label')}><span className="txd-pre">{b.remittance_information.join('\n')}</span></Row>}
            {(b.creditor_name || b.debtor_name) && <Row label={t('operations.detail.counterparty')}>{b.creditor_name ?? b.debtor_name}{(b.creditor_iban ?? b.debtor_iban) ? ` · ···${(b.creditor_iban ?? b.debtor_iban)!.slice(-4)}` : ''}</Row>}
            {b.transaction_date && <Row label={t('operations.detail.transaction_date')}>{formatTxDate(b.transaction_date)}</Row>}
            {b.booking_date && <Row label={t('operations.detail.booking_date')}>{formatTxDate(b.booking_date)}</Row>}
            {b.value_date && <Row label={t('operations.detail.value_date')}>{formatTxDate(b.value_date)}</Row>}
            {b.bank_transaction_code && <Row label={t('operations.detail.bank_code')}>{b.bank_transaction_code}</Row>}
            {b.merchant_category_code && <Row label={t('operations.detail.mcc')}>{b.merchant_category_code}</Row>}
            {b.balance_after != null && <Row label={t('operations.detail.balance_after')}>{money(b.balance_after, currency)}</Row>}
            {b.exchange_rate != null && <Row label={t('operations.detail.exchange_rate')}>{typeof b.exchange_rate === 'object' ? JSON.stringify(b.exchange_rate) : String(b.exchange_rate)}</Row>}
            {b.entry_reference && <Row label={t('operations.detail.reference')}><code>{b.entry_reference}</code></Row>}
            {b.status && b.status !== 'BOOK' && <Row label={t('operations.detail.status')}>{b.status}</Row>}
          </Section>
        ))}

        <Section title={t('operations.detail.section_origin')}>
          <Row label={t('operations.detail.origin')}>
            {origin === 'sync'
              ? t('operations.detail.origin_sync', { bank: bankData[0]?.bank ?? t('operations.detail.the_bank') })
              : origin === 'import' ? t('operations.detail.origin_import') : t('operations.detail.origin_manual')}
          </Row>
          {bankData[0]?.synced_at && <Row label={t('operations.detail.synced_at')}>{new Date(bankData[0].synced_at).toLocaleString()}</Row>}
          <Row label={t('operations.detail.created_at')}>{new Date(tx.created_at).toLocaleString()}</Row>
          <Row label={t('operations.detail.id')}><code>#{tx.id}</code></Row>
        </Section>
        {bankData.length === 0 && <p className="muted txd-hint">{t('operations.detail.no_bank_data')}</p>}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="txd-section">
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
