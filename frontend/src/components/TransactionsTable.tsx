import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronDown, ChevronUp, ChevronsUpDown, Circle, Pencil } from 'lucide-react';
import { CategoryHint, CategoryName } from './CategoryName';
import { refundedAmount, type Account, type Category, type Transaction } from '@suzanne/shared';
import { money, txLabel, typeLabel } from '../lib/format';
import { pickableAccounts } from '../lib/account';
import { RowMenu, useTxMenuItems, type TxActionHandlers } from './transactions/RowMenu';
import { formatTxDate, formatTxDay, isReadOnly, txAmountLabel, txTone } from './transactions/txUtils';
import type { TxSort, TxSortKey } from './transactions/useTransactionFilters';

export type { TxSort, TxSortKey } from './transactions/useTransactionFilters';

// Journal desktop. Par ligne : pointer + modifier visibles, le reste dans
// « ⋯ ». Les opérations de bourse (kind 'trade') sont en lecture seule.
export function TransactionsTable({
  transactions,
  emptyMessage,
  compact = false,
  categories,
  accounts,
  categoryById,
  accountById,
  selectedIds,
  sort,
  onSort,
  onSelect,
  onSelectAll,
  onInlineUpdate,
  onEdit,
  onToggleCleared,
  actions,
  highlightId = null,
}: {
  transactions: Transaction[];
  emptyMessage: string;
  compact?: boolean;
  categories: Category[];
  accounts: Account[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  selectedIds: Set<number>;
  sort: TxSort;
  onSort: (key: TxSortKey) => void;
  onSelect: (transactionId: number, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  onInlineUpdate: (transaction: Transaction, patch: Partial<Pick<Transaction, 'account_id' | 'to_account_id' | 'category_id'>>) => void;
  onEdit: (transaction: Transaction) => void;
  onToggleCleared: (transaction: Transaction) => void;
  actions: TxActionHandlers;
  // Transaction ciblée par un deep link : la ligne flashe et défile en vue.
  highlightId?: number | null;
}) {
  const { t } = useTranslation();
  const menuItems = useTxMenuItems();
  const wrapRef = useRef<HTMLDivElement>(null);
  // Ne dépend QUE de highlightId : un reload de la liste ne doit pas refaire
  // défiler la page.
  useEffect(() => {
    if (highlightId === null) return;
    wrapRef.current?.querySelector(`[data-tx="${highlightId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightId]);

  if (transactions.length === 0) return <p className="empty jr-empty">{emptyMessage}</p>;
  const selectable = transactions.filter((tx) => !isReadOnly(tx));
  const allSelected = selectable.length > 0 && selectable.every((tx) => selectedIds.has(tx.id));
  const thisYear = String(new Date().getFullYear());

  const sortableTh = (key: TxSortKey, label: string, thClass?: string) => {
    const active = sort.key === key;
    return (
      <th className={thClass} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button type="button" className={`th-sort ${active ? 'active' : ''}`} onClick={() => onSort(key)}>
          <span>{label}</span>
          {active ? (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ChevronsUpDown size={13} />}
        </button>
      </th>
    );
  };

  return (
    <div className="table-wrap jr-table-wrap" ref={wrapRef}>
      <table className={`tx-table jr-table${compact ? ' compact' : ''}`}>
        <thead>
          <tr>
            <th className="select-cell">
              <input type="checkbox" aria-label={t('operations.select_all_visible_transactions')} checked={allSelected} onChange={(e) => onSelectAll(e.target.checked)} />
            </th>
            {sortableTh('date', t('operations.date'))}
            {sortableTh('label', t('operations.label'))}
            {sortableTh('type', t('operations.type'))}
            <th>{t('operations.account')}</th>
            <th>{t('commun.category')}</th>
            {sortableTh('amount', t('operations.amount'), 'jr-amount-col')}
            <th className="jr-actions-col"><span className="jr-sr">{t('operations.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const readOnly = isReadOnly(tx);
            const srcCurrency = accountById.get(tx.account_id ?? -1)?.currency ?? 'EUR';
            const splits = tx.splits ?? [];
            const linked = tx.recurring_transaction_id != null;
            const refunded = tx.type === 'expense' ? refundedAmount(tx) : 0;
            const allocationCount = tx.refund_allocations?.length ?? 0;
            const isRefundIncome = tx.type === 'income' && (allocationCount > 0 || tx.refunds_transaction_id != null);
            const selected = selectedIds.has(tx.id);
            const category = categoryById.get(tx.category_id ?? -1);
            const accent = categoryById.get(splits[0]?.category_id ?? -1)?.color ?? category?.color ?? 'transparent';
            const label = txLabel(tx, categoryById);
            const accountName = (id: number | null) => accountById.get(id ?? -1)?.name ?? t('operations.no_account');
            return (
              <tr
                key={tx.id}
                data-tx={tx.id}
                className={[selected ? 'tx-selected' : '', tx.id === highlightId ? 'tx-highlight' : '', readOnly ? 'jr-readonly' : ''].filter(Boolean).join(' ') || undefined}
                style={{ ['--tx-accent' as string]: accent }}
              >
                <td className="select-cell">
                  {!readOnly && (
                    <input type="checkbox" aria-label={t('operations.select_label', { label })} checked={selected} onChange={(e) => onSelect(tx.id, e.target.checked)} />
                  )}
                </td>
                <td className="nowrap tx-accent jr-date" title={formatTxDate(tx.date)}>{formatTxDay(tx.date, !tx.date.startsWith(thisYear))}</td>
                <td className="jr-label-cell">
                  <span className="jr-label" title={label}>{label}</span>
                  <span className="jr-badges">
                    {readOnly && <span className="jr-badge">{t('operations.stock_market')}</span>}
                    {linked && <span className="jr-badge" title={t('operations.linked_to_recurring_item')}>↻ {t('operations.recurring_2')}</span>}
                    {refunded > 0 && (
                      <span className="jr-badge" title={t('operations.refunded_b', { a: money(refunded, srcCurrency), b: money(tx.amount, srcCurrency) })}>
                        {refunded >= tx.amount ? t('operations.refunded') : `↩ ${money(refunded, srcCurrency)}`}
                      </span>
                    )}
                    {isRefundIncome && (
                      <span className="jr-badge" title={tx.refunds_transaction ? t('operations.refunds_label_date', { label: tx.refunds_transaction.description ?? `#${tx.refunds_transaction.id}`, date: formatTxDate(tx.refunds_transaction.date) }) : undefined}>
                        {allocationCount > 1 ? t('operations.n_expenses', { n: allocationCount }) : t('operations.refund_4')}
                      </span>
                    )}
                    {(tx.tags ?? []).map((tag) => (
                      <span key={tag.id} className="tag-chip mini" style={{ background: tag.color }}>{tag.name}</span>
                    ))}
                  </span>
                </td>
                <td><span className={`jr-type ${tx.type}`}>{typeLabel(tx.type)}</span></td>
                <td>
                  {readOnly ? (
                    <span className="jr-muted">{accountName(tx.account_id)}</span>
                  ) : (
                    <div className={tx.type === 'transfer' ? 'jr-stack' : undefined}>
                      <select
                        className="inline-select"
                        value={tx.account_id ?? ''}
                        aria-label={tx.type === 'transfer' ? t('operations.source_account') : t('operations.account')}
                        onChange={(e) => onInlineUpdate(tx, { account_id: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">{t('operations.no_account')}</option>
                        {pickableAccounts(accounts, tx.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      {tx.type === 'transfer' && (
                        <select
                          className="inline-select"
                          value={tx.to_account_id ?? ''}
                          aria-label={t('operations.destination_account')}
                          onChange={(e) => onInlineUpdate(tx, { to_account_id: e.target.value ? Number(e.target.value) : null })}
                        >
                          <option value="">{t('operations.no_account')}</option>
                          {pickableAccounts(accounts, tx.to_account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  {tx.type === 'transfer' || readOnly ? (
                    <CategoryName className="jr-muted" category={category} />
                  ) : splits.length > 0 ? (
                    <div className="jr-splits">
                      {splits.map((split, i) => {
                        const c = categoryById.get(split.category_id ?? -1);
                        return (
                          <span key={`${split.category_id}-${i}`}>
                            <i style={{ background: c?.color ?? 'var(--faint)' }} />
                            <CategoryName category={c} fallback={t('commun.category')} /> <span className="jr-num">{money(split.amount, srcCurrency)}</span>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <CategoryHint category={category}>
                      <select
                        className="inline-select"
                        value={tx.category_id ?? ''}
                        aria-label={t('commun.category')}
                        onChange={(e) => onInlineUpdate(tx, { category_id: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">{t('operations.no_category')}</option>
                        {categories.filter((c) => c.type === tx.type).map((c) => <option key={c.id} value={c.id} title={c.description ?? undefined}>{c.name}</option>)}
                      </select>
                    </CategoryHint>
                  )}
                </td>
                <td className={`jr-num jr-amt jr-amount-col ${txTone(tx)}`}>{txAmountLabel(tx, accountById)}</td>
                <td className="jr-actions-col">
                  {!readOnly && (
                    <div className="jr-row-actions">
                      <button
                        type="button"
                        className={`icon-ghost jr-clear${tx.cleared ? ' on' : ''}`}
                        aria-pressed={tx.cleared}
                        aria-label={tx.cleared ? t('operations.cleared_click_to_unclear') : t('operations.mark_as_cleared_matched_with')}
                        title={tx.cleared ? t('operations.cleared_click_to_unclear') : t('operations.mark_as_cleared_matched_with')}
                        onClick={() => onToggleCleared(tx)}
                      >
                        {tx.cleared ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                      </button>
                      <button type="button" className="icon-ghost" aria-label={t('operations.edit')} title={t('operations.edit')} onClick={() => onEdit(tx)}>
                        <Pencil size={16} />
                      </button>
                      <RowMenu items={menuItems(tx, actions)} />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
