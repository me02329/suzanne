import { FormEvent } from 'react';
import { FolderTree } from 'lucide-react';
import type { Category } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';

type Run = (fn: () => Promise<unknown>, message?: string) => Promise<void>;

export function Categories({ userId, categories, run }: { userId: number; categories: Category[]; run: Run }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createCategory(userId, {
      name: String(data.get('name')),
      type: String(data.get('type')) as Category['type'],
      color: String(data.get('color')),
      icon: String(data.get('icon') || ''),
    }));
    event.currentTarget.reset();
  };

  return (
    <section className="split">
      <Panel title="Nouvelle catégorie">
        <form className="form" onSubmit={submit}>
          <label>Nom<input name="name" required /></label>
          <label>Type<select name="type"><option value="expense">Dépense</option><option value="income">Revenu</option></select></label>
          <label>Couleur<input name="color" type="color" defaultValue="#6366f1" /></label>
          <label>Icône<input name="icon" placeholder="shopping-cart" /></label>
          <button className="primary"><FolderTree size={16} /> Ajouter</button>
        </form>
      </Panel>
      <Panel title="Catégories">
        <DataTable empty={categories.length === 0 ? 'Aucune catégorie.' : null}>
          <thead><tr><th>Nom</th><th>Type</th><th>Icône</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td><span className="dot inline" style={{ background: c.color }} /><strong>{c.name}</strong></td>
                <td><span className={`pill ${c.type}`}>{c.type === 'income' ? 'Revenu' : 'Dépense'}</span></td>
                <td>{c.icon ?? '-'}</td>
                <td className="actions-cell">
                  <IconButton label="Supprimer" confirm={`Supprimer la catégorie « ${c.name} » ?`} onClick={() => void run(() => api.deleteCategory(userId, c.id), 'Catégorie supprimée')} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}
