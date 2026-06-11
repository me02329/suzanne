import type { Account, Category, Transaction } from '@suzanne-lite/shared';
import { money, txLabel } from '../lib/format';

export function TransactionList({ transactions, categoryById, accountById, onPick }: {
  transactions: Transaction[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  // Si fourni, chaque ligne devient cliquable (drill-down vers la transaction).
  onPick?: (transaction: Transaction) => void;
}) {
  if (transactions.length === 0) return <p className="empty">Aucune transaction.</p>;
  return (
    <div className="transactions">
      {transactions.map((t) => {
        const sourceCurrency = accountById.get(t.account_id ?? -1)?.currency ?? 'EUR';
        const destinationCurrency = accountById.get(t.to_account_id ?? -1)?.currency ?? sourceCurrency;
        const categoryLabel = (t.splits ?? []).length > 0
          ? t.splits.map((split) => categoryById.get(split.category_id)?.name ?? 'Catégorie').join(' + ')
          : categoryById.get(t.category_id ?? -1)?.name ?? 'Sans catégorie';
        const content = (
          <>
            <div>
              <strong title={txLabel(t, categoryById)}>{txLabel(t, categoryById)}</strong>
              <span title={`${accountById.get(t.account_id ?? -1)?.name ?? 'Sans compte'} · ${categoryLabel}`}>{new Date(t.date).toLocaleDateString('fr-FR')} · {accountById.get(t.account_id ?? -1)?.name ?? 'Sans compte'} · {categoryLabel}</span>
            </div>
            {t.type === 'transfer'
              ? <strong className="transfer">{money(t.amount, sourceCurrency)} {'->'} {money(t.to_amount ?? t.amount, destinationCurrency)}</strong>
              : <strong className={t.type === 'income' ? 'income' : 'expense'}>{t.type === 'income' ? '+' : '-'}{money(t.amount, sourceCurrency)}</strong>}
          </>
        );
        if (onPick) {
          return (
            <button type="button" className="tx tx-clickable" key={t.id} onClick={() => onPick(t)}>
              {content}
            </button>
          );
        }
        return <div className="tx" key={t.id}>{content}</div>;
      })}
    </div>
  );
}
