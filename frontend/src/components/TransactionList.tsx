import type { Account, Category, Transaction } from '@suzanne-lite/shared';
import { money, txLabel } from '../lib/format';

export function TransactionList({ transactions, categoryById, accountById }: {
  transactions: Transaction[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
}) {
  if (transactions.length === 0) return <p className="empty">Aucune transaction.</p>;
  return (
    <div className="transactions">
      {transactions.map((t) => {
        const sourceCurrency = accountById.get(t.account_id ?? -1)?.currency ?? 'EUR';
        const destinationCurrency = accountById.get(t.to_account_id ?? -1)?.currency ?? sourceCurrency;
        return (
          <div className="tx" key={t.id}>
            <div>
              <strong>{txLabel(t, categoryById)}</strong>
              <span>{new Date(t.date).toLocaleDateString('fr-FR')} · {accountById.get(t.account_id ?? -1)?.name ?? 'Sans compte'} · {categoryById.get(t.category_id ?? -1)?.name ?? 'Sans catégorie'}</span>
            </div>
            {t.type === 'transfer'
              ? <strong className="transfer">{money(t.amount, sourceCurrency)} {'->'} {money(t.to_amount ?? t.amount, destinationCurrency)}</strong>
              : <strong className={t.type === 'income' ? 'income' : 'expense'}>{t.type === 'income' ? '+' : '-'}{money(t.amount, sourceCurrency)}</strong>}
          </div>
        );
      })}
    </div>
  );
}
