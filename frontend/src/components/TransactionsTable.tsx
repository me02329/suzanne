import { Copy, Pencil, Repeat } from 'lucide-react';
import type { Account, Category, Transaction } from '@suzanne-lite/shared';
import { money, txLabel, typeLabel } from '../lib/format';
import { IconButton } from './IconButton';

export function TransactionsTable({
  transactions,
  categories,
  accounts,
  categoryById,
  accountById,
  selectedIds,
  onSelect,
  onSelectAll,
  onInlineUpdate,
  onEdit,
  onCopy,
  onLink,
  onDelete,
}: {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  selectedIds: Set<number>;
  onSelect: (transactionId: number, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  onInlineUpdate: (transaction: Transaction, patch: Partial<Pick<Transaction, 'account_id' | 'to_account_id' | 'category_id'>>) => void;
  onEdit: (transaction: Transaction) => void;
  onCopy: (transaction: Transaction) => void;
  onLink: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  if (transactions.length === 0) return <p className="empty">Aucune transaction sur ce mois.</p>;
  const allSelected = transactions.length > 0 && transactions.every((t) => selectedIds.has(t.id));
  return (
    <div className="table-wrap">
      <table className="tx-table">
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
            <th>Date</th>
            <th>Libellé</th>
            <th>Type</th>
            <th>Compte</th>
            <th>Catégorie</th>
            <th className="amount-cell">Montant</th>
            <th className="actions-cell">Actions</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const sourceAccount = accountById.get(t.account_id ?? -1);
            const destinationAccount = accountById.get(t.to_account_id ?? -1);
            const category = categoryById.get(t.category_id ?? -1);
            const amountLabel = t.type === 'transfer'
              ? `${money(t.amount, sourceAccount?.currency ?? 'EUR')} -> ${money(t.to_amount ?? t.amount, destinationAccount?.currency ?? sourceAccount?.currency ?? 'EUR')}`
              : `${t.type === 'income' ? '+' : '-'}${money(t.amount, sourceAccount?.currency ?? 'EUR')}`;
            const linked = t.recurring_transaction_id != null;
            const selected = selectedIds.has(t.id);
            const compatibleCategories = categories.filter((c) => c.type === t.type);
            const accent = category?.color
              ?? (t.type === 'income' ? 'var(--income)' : t.type === 'transfer' ? 'var(--accent)' : 'var(--expense)');
            return (
              <tr
                key={t.id}
                className={[linked ? 'tx-linked' : '', selected ? 'tx-selected' : ''].filter(Boolean).join(' ') || undefined}
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
                <td className="nowrap tx-accent">{new Date(t.date).toLocaleDateString('fr-FR')}</td>
                <td>
                  <strong>
                    {txLabel(t, categoryById)}
                    {linked && <span className="badge-recurring" title="Liée à une récurrence">↻</span>}
                  </strong>
                  {t.description && category?.name && <span>{category.name}</span>}
                </td>
                <td><span className={`pill ${t.type}`}>{typeLabel(t.type)}</span></td>
                <td>
                  <div className={t.type === 'transfer' ? 'inline-edit-stack' : undefined}>
                    <select
                      className="inline-select"
                      value={t.account_id ?? ''}
                      title={t.type === 'transfer' ? 'Compte source' : 'Compte'}
                      onChange={(e) => onInlineUpdate(t, { account_id: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Sans compte</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {t.type === 'transfer' && (
                      <select
                        className="inline-select"
                        value={t.to_account_id ?? ''}
                        title="Compte destination"
                        onChange={(e) => onInlineUpdate(t, { to_account_id: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">Sans compte</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    )}
                  </div>
                </td>
                <td>
                  {t.type === 'transfer' ? (
                    'Transfert'
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
                <td className={`amount-cell ${t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer'}`}>
                  {amountLabel}
                </td>
                <td className="actions-cell">
                  <IconButton label="Copier" tone="neutral" icon={<Copy size={16} />} onClick={() => onCopy(t)} />
                  <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => onEdit(t)} />
                  <IconButton
                    label={linked ? 'Récurrence liée — modifier le lien' : 'Lier à une récurrence'}
                    tone={linked ? 'accent' : 'neutral'}
                    icon={<Repeat size={16} />}
                    onClick={() => onLink(t)}
                  />
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
