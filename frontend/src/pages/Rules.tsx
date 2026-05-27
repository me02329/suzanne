import { FormEvent } from 'react';
import type { Category, CategoryRule } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';

type Run = (fn: () => Promise<unknown>, message?: string) => Promise<void>;

export function Rules({ userId, rules, categories, categoryById, run }: {
  userId: number;
  rules: CategoryRule[];
  categories: Category[];
  categoryById: Map<number, Category>;
  run: Run;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.setRule(userId, {
      pattern: String(data.get('pattern')),
      category_id: Number(data.get('category_id')),
    }), 'Règle enregistrée');
    event.currentTarget.reset();
  };
  return (
    <section className="split">
      <Panel title="Nouvelle règle">
        <form className="form" onSubmit={submit}>
          <label>Mot-clé<input name="pattern" placeholder="CARREFOUR" required /></label>
          <label>Catégorie<select name="category_id" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <button className="primary">Enregistrer</button>
        </form>
      </Panel>
      <Panel title="Règles">
        <DataTable empty={rules.length === 0 ? 'Aucune règle.' : null}>
          <thead><tr><th>Mot-clé</th><th>Catégorie</th><th>Créée le</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.pattern}</strong></td>
                <td>{categoryById.get(r.category_id)?.name ?? 'Catégorie'}</td>
                <td>{new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
                <td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteRule(userId, r.id), 'Règle supprimée')} /></td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}
