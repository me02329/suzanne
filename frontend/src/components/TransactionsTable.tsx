import { Copy, Pencil, Repeat } from 'lucide-react';
import type { Account, Category, Transaction } from '@suzanne-lite/shared';
import { money, txLabel, typeLabel } from '../lib/format';
import { IconButton } from './IconButton';

export function TransactionsTable({ transactions, categoryById, accountById, onEdit, onCopy, onLink, onDelete }: {
  transactions: Transaction[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  onEdit: (transaction: Transaction) => void;
  onCopy: (transaction: Transaction) => void;
  onLink: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  if (transactions.length === 0) return <p className="empty">Aucune transaction sur ce mois.</p>;
  return (
    <div className="table-wrap">
      <table className="tx-table">
        <thead>
          <tr>
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
            const source = sourceAccount?.name ?? 'Sans compte';
            const destinationAccount = accountById.get(t.to_account_id ?? -1);
            const destination = destinationAccount?.name ?? 'Sans compte';
            const category = categoryById.get(t.category_id ?? -1);
            const amountLabel = t.type === 'transfer'
              ? `${money(t.amount, sourceAccount?.currency ?? 'EUR')} -> ${money(t.to_amount ?? t.amount, destinationAccount?.currency ?? sourceAccount?.currency ?? 'EUR')}`
              : `${t.type === 'income' ? '+' : '-'}${money(t.amount, sourceAccount?.currency ?? 'EUR')}`;
            const linked = t.recurring_transaction_id != null;
            return (
              <tr key={t.id} className={linked ? 'tx-linked' : undefined}>
                <td className="nowrap">{new Date(t.date).toLocaleDateString('fr-FR')}</td>
                <td>
                  <strong>
                    {txLabel(t, categoryById)}
                    {linked && <span className="badge-recurring" title="Liée à une récurrence">↻</span>}
                  </strong>
                  {t.description && category?.name && <span>{category.name}</span>}
                </td>
                <td><span className={`pill ${t.type}`}>{typeLabel(t.type)}</span></td>
                <td>{t.type === 'transfer' ? `${source} -> ${destination}` : source}</td>
                <td>{t.type === 'transfer' ? 'Transfert' : category?.name ?? 'Sans catégorie'}</td>
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
