import { FormEvent, useState } from 'react';
import { ChevronDown, ChevronUp, FolderTree, Pencil, Plus } from 'lucide-react';
import type { Category } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

export function Categories({ userId, categories, run }: { userId: number; categories: Category[]; run: Run }) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [addOpen, setAddOpen] = usePersistedState<boolean>('categories_add_open', categories.length === 0);

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

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.updateCategory(userId, editing.id, {
      name: String(data.get('name')),
      type: String(data.get('type')) as Category['type'],
      color: String(data.get('color')),
      icon: String(data.get('icon') || ''),
    }), 'Catégorie mise à jour');
    setEditing(null);
  };

  return (
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouvelle catégorie</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {addOpen && (
          <div className="collapsible-body">
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">Nom<input name="name" required /></label>
              <label>Type<select name="type"><option value="expense">Dépense</option><option value="income">Revenu</option></select></label>
              <label>Couleur<input name="color" type="color" defaultValue="#6366f1" /></label>
              <label>Icône<input name="icon" placeholder="shopping-cart" /></label>
              <button className="primary"><Plus size={16} /> Ajouter</button>
            </form>
          </div>
        )}
      </div>
      <Panel title="Catégories" icon={<FolderTree />}>
        <DataTable empty={categories.length === 0 ? 'Aucune catégorie.' : null}>
          <thead><tr><th>Nom</th><th>Type</th><th>Icône</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td><span className="dot inline" style={{ background: c.color }} /><strong>{c.name}</strong></td>
                <td><span className={`pill ${c.type}`}>{c.type === 'income' ? 'Revenu' : 'Dépense'}</span></td>
                <td>{c.icon ?? '-'}</td>
                <td className="actions-cell">
                  <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(c)} />
                  <IconButton label="Supprimer" confirm={`Supprimer la catégorie « ${c.name} » ?`} onClick={() => void run(() => api.deleteCategory(userId, c.id), 'Catégorie supprimée')} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>

      {editing && (
        <Modal title={`Modifier « ${editing.name} »`} onClose={() => setEditing(null)}>
          <form className="form" onSubmit={submitEdit} key={editing.id}>
            <label>Nom<input name="name" defaultValue={editing.name} required /></label>
            <label>Type
              <select name="type" defaultValue={editing.type}>
                <option value="expense">Dépense</option>
                <option value="income">Revenu</option>
              </select>
            </label>
            <label>Couleur<input name="color" type="color" defaultValue={editing.color} /></label>
            <label>Icône<input name="icon" defaultValue={editing.icon ?? ''} placeholder="shopping-cart" /></label>
            <button className="primary">Enregistrer</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>Annuler</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
