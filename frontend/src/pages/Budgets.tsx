import { FormEvent } from 'react';
import type { Budget, Category, DashboardSummary } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';

type Run = (fn: () => Promise<unknown>, message?: string) => Promise<void>;

export function Budgets({ userId, month, categories, budgets, summary, run }: {
  userId: number;
  month: string;
  categories: Category[];
  budgets: Budget[];
  summary: DashboardSummary | null;
  run: Run;
}) {
  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const spentByCategory = new Map((summary?.expenses_by_category ?? []).map((c) => [c.category_id, c.amount]));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.setBudget(userId, {
      category_id: Number(data.get('category_id')),
      month,
      amount_limit: Number(data.get('amount_limit')),
    }), 'Budget enregistré');
    event.currentTarget.reset();
  };
  return (
    <section className="split">
      <Panel title={`Budget ${month}`} sticky>
        <p className="panel-note">Limite mensuelle de dépense par catégorie. Ne bloque rien — sert juste de garde-fou visuel pour repérer les dépassements.</p>
        <form className="form" onSubmit={submit}>
          <label>Catégorie<select name="category_id" required>{expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Limite<input name="amount_limit" type="number" min="0.01" step="0.01" required /></label>
          <button className="primary">Enregistrer</button>
        </form>
      </Panel>
      <Panel title="Suivi">
        <DataTable empty={budgets.length === 0 ? 'Aucun budget pour ce mois.' : null}>
          <thead><tr><th>Catégorie</th><th className="amount-cell">Dépensé</th><th className="amount-cell">Limite</th><th>Progression</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {budgets.map((b) => {
              const category = categories.find((c) => c.id === b.category_id);
              const spent = spentByCategory.get(b.category_id) ?? 0;
              const pct = Math.min(100, (spent / b.amount_limit) * 100);
              return (
                <tr key={b.id}>
                  <td><strong>{category?.name ?? 'Catégorie'}</strong></td>
                  <td className="amount-cell expense">{money(spent)}</td>
                  <td className="amount-cell">{money(b.amount_limit)}</td>
                  <td>
                    <div className="bar"><span style={{ width: `${pct}%`, background: pct >= 100 ? '#dc2626' : '#4f46e5' }} /></div>
                    <span>{Math.round(pct)} %</span>
                  </td>
                  <td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteBudget(userId, b.id), 'Budget supprimé')} /></td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}
