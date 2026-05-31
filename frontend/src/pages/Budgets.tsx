import { FormEvent } from 'react';
import { ChevronDown, ChevronUp, Plus, Target } from 'lucide-react';
import type { Budget, Category, DashboardSummary } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

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
  const [addOpen, setAddOpen] = usePersistedState<boolean>('budgets_add_open', budgets.length === 0);
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
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouveau budget · {month}</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {addOpen && (
          <div className="collapsible-body">
            <p className="panel-note">Limite mensuelle de dépense par catégorie. Ne bloque rien — sert juste de garde-fou visuel pour repérer les dépassements.</p>
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">Catégorie<select name="category_id" required>{expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Limite<input name="amount_limit" type="number" min="0.01" step="0.01" required /></label>
              <button className="primary"><Plus size={16} /> Enregistrer</button>
            </form>
          </div>
        )}
      </div>
      <Panel title="Suivi" icon={<Target />}>
        <DataTable empty={budgets.length === 0 ? 'Aucun budget pour ce mois.' : null}>
          <thead><tr><th>Catégorie</th><th className="amount-cell">Dépensé</th><th className="amount-cell">Limite</th><th>Progression</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {budgets.map((b) => {
              const category = categories.find((c) => c.id === b.category_id);
              const spent = spentByCategory.get(b.category_id) ?? 0;
              const pct = Math.min(100, (spent / b.amount_limit) * 100);
              return (
                <tr key={b.id}>
                  <td><strong title={category?.name ?? 'Catégorie'}>{category?.name ?? 'Catégorie'}</strong></td>
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
