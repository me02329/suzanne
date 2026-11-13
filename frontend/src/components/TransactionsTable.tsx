import { useEffect, useRef } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, ChevronsUpDown, Copy, HandCoins, Paperclip, Pencil, Repeat, Split } from 'lucide-react';
import { refundedAmount, type Account, type Category, type Transaction } from '@suzanne/shared';
import { money, txLabel, typeLabel } from '../lib/format';
import { pickableAccounts } from '../lib/account';
import { IconButton } from './IconButton';

export type TxSortKey = 'date' | 'label' | 'type' | 'amount';
export interface TxSort {
  key: TxSortKey;
  dir: 'asc' | 'desc';
}

export function TransactionsTable({
  transactions,
  emptyMessage = 'Aucune transaction sur ce mois.',
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
  onCopy,
  onLink,
  onRefund,
  onSplit,
  onToggleCleared,
  onAttachments,
  onDelete,
  highlightId = null,
}: {
  transactions: Transaction[];
  emptyMessage?: string;
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
  onCopy: (transaction: Transaction) => void;
  onLink: (transaction: Transaction) => void;
  // Dépense : enregistrer un remboursement. Revenu : lier à la dépense remboursée.
  onRefund: (transaction: Transaction) => void;
  // Ouvre l'édition avec l'éditeur de ventilation déjà actif.
  onSplit: (transaction: Transaction) => void;
  // Pointage : bascule le statut « rapprochée du relevé bancaire ».
  onToggleCleared: (transaction: Transaction) => void;
  // Ouvre la gestion des pièces jointes de la transaction.
  onAttachments: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
  // Transaction ciblée par un drill-down : la ligne flashe et défile en vue.
  highlightId?: number | null;
}) {
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (highlightId !== null) highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightId, transactions]);
  if (transactions.length === 0) return <p className="empty">{emptyMessage}</p>;
  const allSelected = transactions.length > 0 && transactions.every((t) => selectedIds.has(t.id));
  const sortableTh = (key: TxSortKey, label: string, thClass?: string) => {
    const active = sort.key === key;
    return (
      <th className={thClass}>
        <button type="button" className={`th-sort ${active ? 'active' : ''}`} onClick={() => onSort(key)}>
          <span>{label}</span>
          {active
            ? (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)
            : <ChevronsUpDown size={13} />}
        </button>
      </th>
    );
  };
  return (
    <div className="table-wrap">
      <table className={`tx-table ${compact ? 'compact' : ''}`}>
        <thead>
          <tr>
            <th className="select-cell">
              <input
                type="checkbox"
                aria-label="Sélectionner toutes les transactions visibles"
                checked={allSelected}
                onChange={(e) => onSelectAll(e.target.checked)}
              />
            </th>
            {sortableTh('date', 'Date')}
            {sortableTh('label', 'Libellé')}
            {sortableTh('type', 'Type')}
            <th>Compte</th>
            <th>Catégorie</th>
            {sortableTh('amount', 'Montant', 'amount-cell')}
            <th className="actions-cell">Actions</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const sourceAccount = accountById.get(t.account_id ?? -1);
            const destinationAccount = accountById.get(t.to_account_id ?? -1);
            const category = categoryById.get(t.category_id ?? -1);
            const splitRows = t.splits ?? [];
            const srcCurrency = sourceAccount?.currency ?? 'EUR';
            const destCurrency = destinationAccount?.currency ?? srcCurrency;
            const isCurrencyConversion = t.type === 'transfer'
              && srcCurrency !== destCurrency
              && t.to_amount != null
              && t.to_amount !== t.amount;
            const amountLabel = t.type === 'transfer'
              ? (isCurrencyConversion
                ? `${money(t.amount, srcCurrency)} → ${money(t.to_amount ?? t.amount, destCurrency)}`
                : money(t.amount, srcCurrency))
              : `${t.type === 'income' ? '+' : '-'}${money(t.amount, srcCurrency)}`;
            const linked = t.recurring_transaction_id != null;
            const refunded = t.type === 'expense' ? refundedAmount(t) : 0;
            const refundAllocationCount = t.refund_allocations?.length ?? 0;
            const isRefundIncome = t.type === 'income' && (refundAllocationCount > 0 || t.refunds_transaction_id != null);
            const selected = selectedIds.has(t.id);
            const compatibleCategories = categories.filter((c) => c.type === t.type);
            const firstSplitCategory = splitRows.length > 0 ? categoryById.get(splitRows[0]!.category_id ?? -1) : null;
            const accent = firstSplitCategory?.color ?? category?.color
              ?? (t.type === 'income' ? 'var(--income)' : t.type === 'transfer' ? 'var(--accent)' : 'var(--expense)');
            return (
              <tr
                key={t.id}
                ref={t.id === highlightId ? highlightRef : undefined}
                className={[linked ? 'tx-linked' : '', selected ? 'tx-selected' : '', t.id === highlightId ? 'tx-highlight' : ''].filter(Boolean).join(' ') || undefined}
                style={{ ['--tx-accent' as string]: accent }}
              >
                <td className="select-cell">
                  <input
                    type="checkbox"
                    aria-label={`Sélectionner la transaction ${txLabel(t, categoryById)}`}
                    checked={selected}
                    onChange={(e) => onSelect(t.id, e.target.checked)}
                  />
                </td>
                <td className="nowrap tx-accent" data-label="Date">{new Date(t.date).toLocaleDateString('fr-FR')}</td>
                <td data-label="Libellé">
                  <strong title={txLabel(t, categoryById)}>
                    {txLabel(t, categoryById)}
                    {linked && <span className="badge-recurring" title="Liée à une récurrence">↻</span>}
                    {refunded > 0 && (
                      <span
                        className="badge-recurring"
                        title={`Remboursé ${money(refunded, srcCurrency)} sur ${money(t.amount, srcCurrency)}`}
                      >
                        {refunded >= t.amount ? '✓ remboursée' : `↩ ${money(refunded, srcCurrency)}`}
                      </span>
                    )}
                    {isRefundIncome && (
                      <span
                        className="badge-recurring"
                        title={refundAllocationCount > 1
                          ? `Rembourse ${refundAllocationCount} dépenses`
                          : t.refunds_transaction
                          ? `Rembourse « ${t.refunds_transaction.description ?? `#${t.refunds_transaction.id}`} » du ${new Date(t.refunds_transaction.date).toLocaleDateString('fr-FR')}`
                          : 'Remboursement lié à une dépense'}
                      >
                        {refundAllocationCount > 1 ? `↩ ${refundAllocationCount} dépenses` : '↩ remboursement'}
                      </span>
                    )}
                  </strong>
                  {splitRows.length > 0 ? (
                    <span className="split-summary">
                      {splitRows.map((split) => {
                        const splitCategory = categoryById.get(split.category_id ?? -1);
                        return `${splitCategory?.name ?? 'Catégorie'} ${money(split.amount, srcCurrency)}`;
                      }).join(' · ')}
                    </span>
                  ) : (
                    t.description && category?.name && <span>{category.name}</span>
                  )}
                  {t.tags && t.tags.length > 0 && (
                    <span className="tag-chip-row">
                      {t.tags.map((tag) => (
                        <span key={tag.id} className="tag-chip mini" style={{ background: tag.color }}>{tag.name}</span>
                      ))}
                    </span>
                  )}
                </td>
                <td data-label="Type"><span className={`pill ${t.type}`}>{typeLabel(t.type)}</span></td>
                <td data-label="Compte">
                  <div className={t.type === 'transfer' ? 'inline-edit-stack' : undefined}>
                    <select
                      className="inline-select"
                      value={t.account_id ?? ''}
                      title={t.type === 'transfer' ? 'Compte source' : 'Compte'}
                      onChange={(e) => onInlineUpdate(t, { account_id: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Sans compte</option>
                      {pickableAccounts(accounts, t.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {t.type === 'transfer' && (
                      <select
                        className="inline-select"
                        value={t.to_account_id ?? ''}
                        title="Compte destination"
                        onChange={(e) => onInlineUpdate(t, { to_account_id: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">Sans compte</option>
                        {pickableAccounts(accounts, t.to_account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    )}
                  </div>
                </td>
                <td data-label="Catégorie">
                  {t.type === 'transfer' ? (
                    'Transfert'
                  ) : splitRows.length > 0 ? (
                    <div className="split-list-mini">
                      {splitRows.map((split) => {
                        const splitCategory = categoryById.get(split.category_id ?? -1);
                        return (
                          <span key={`${split.category_id}-${split.amount}`}>
                            <i style={{ background: splitCategory?.color ?? '#9ca3af' }} />
                            {splitCategory?.name ?? 'Catégorie'} · {money(split.amount, srcCurrency)}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <select
                      className="inline-select"
                      value={t.category_id ?? ''}
                      onChange={(e) => onInlineUpdate(t, { category_id: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Sans catégorie</option>
                      {compatibleCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                </td>
                <td className={`amount-cell ${t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer'}`} data-label="Montant">
                  {amountLabel}
                </td>
                <td className="actions-cell" data-label="Actions">
                  <IconButton
                    label={t.cleared ? 'Pointée — cliquer pour dépointer' : 'Pointer (rapprochée du relevé)'}
                    tone={t.cleared ? 'accent' : 'neutral'}
                    icon={<CheckCircle2 size={16} />}
                    onClick={() => onToggleCleared(t)}
                  />
                  <IconButton label="Copier" tone="neutral" icon={<Copy size={16} />} onClick={() => onCopy(t)} />
                  <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => onEdit(t)} />
                  <IconButton
                    label={linked ? 'Récurrence liée — modifier le lien' : 'Lier à une récurrence'}
                    tone={linked ? 'accent' : 'neutral'}
                    icon={<Repeat size={16} />}
                    onClick={() => onLink(t)}
                  />
                  {t.type !== 'transfer' && (
                    <IconButton
                      label={splitRows.length > 0 ? 'Ventilée — modifier la ventilation' : 'Ventiler en plusieurs catégories'}
                      tone={splitRows.length > 0 ? 'accent' : 'neutral'}
                      icon={<Split size={16} />}
                      onClick={() => onSplit(t)}
                    />
                  )}
                  {t.type !== 'transfer' && (
                    <IconButton
                      label={t.type === 'expense'
                        ? (refunded > 0 ? 'Remboursée en partie — ajouter un remboursement' : 'Enregistrer un remboursement')
                        : (isRefundIncome ? 'Remboursement lié — modifier le lien' : 'Lier à une dépense remboursée')}
                      tone={refunded > 0 || isRefundIncome ? 'accent' : 'neutral'}
                      icon={<HandCoins size={16} />}
                      onClick={() => onRefund(t)}
                    />
                  )}
                  <IconButton label="Pièces jointes" tone="neutral" icon={<Paperclip size={16} />} onClick={() => onAttachments(t)} />
                  <IconButton label="Supprimer" confirm="Supprimer cette transaction ?" onClick={() => onDelete(t)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
