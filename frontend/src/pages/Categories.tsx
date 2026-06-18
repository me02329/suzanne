import { FormEvent, useState } from 'react';
import { ChevronDown, ChevronUp, FolderTree, GitMerge, Pencil, Plus } from 'lucide-react';
import type { Category } from '@suzanne/shared';
import { api } from '../lib/api';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

export function Categories({ userId, categories, run }: { userId: number; categories: Category[]; run: Run }) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [merging, setMerging] = useState<Category | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [addOpen, setAddOpen] = usePersistedState<boolean>('categories_add_open', categories.length === 0);

  // Cibles de fusion possibles : autres catégories du même type (les revenus et
  // dépenses ne se mélangent pas, comme côté backend).
  const mergeTargets = merging ? categories.filter((c) => c.id !== merging.id && c.type === merging.type) : [];
  const startMerge = (category: Category) => { setMerging(category); setMergeTargetId(''); };
  const submitMerge = () => {
    if (!merging) return;
    const targetId = Number(mergeTargetId);
    if (!Number.isFinite(targetId) || targetId <= 0) return;
    const targetName = categories.find((c) => c.id === targetId)?.name ?? 'la cible';
    void run(
      () => api.mergeCategory(userId, merging.id, targetId),
      `« ${merging.name} » fusionnée dans « ${targetName} »`,
    ).then((ok) => { if (ok) setMerging(null); });
  };

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
                <td><span className="dot inline" style={{ background: c.color }} /><strong title={c.name}>{c.name}</strong></td>
                <td><span className={`pill ${c.type}`}>{c.type === 'income' ? 'Revenu' : 'Dépense'}</span></td>
                <td>{c.icon ?? '-'}</td>
                <td className="actions-cell">
                  <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(c)} />
                  <IconButton label="Fusionner dans une autre catégorie" tone="neutral" icon={<GitMerge size={16} />} onClick={() => startMerge(c)} />
                  <IconButton label="Supprimer" confirm={`Supprimer la catégorie « ${c.name} » ? Ses transactions resteront mais perdront leur catégorie.`} onClick={() => void run(() => api.deleteCategory(userId, c.id), 'Catégorie supprimée')} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>

      {merging && (
        <Modal title={`Fusionner « ${merging.name} »`} onClose={() => setMerging(null)}>
          <div className="form">
            <p className="panel-note">
              Toutes les transactions, ventilations, budgets, récurrents, règles et factures de
              « {merging.name} » seront réaffectés à la catégorie cible, puis « {merging.name} » sera supprimée.
              Action irréversible.
            </p>
            {mergeTargets.length === 0 ? (
              <p className="empty">Aucune autre catégorie {merging.type === 'income' ? 'de revenu' : 'de dépense'} disponible.</p>
            ) : (
              <label>Fusionner dans
                <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)} autoFocus>
                  <option value="">Choisir la catégorie cible…</option>
                  {mergeTargets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <button className="primary" disabled={!mergeTargetId} onClick={submitMerge}>Fusionner</button>
            <button type="button" className="secondary" onClick={() => setMerging(null)}>Annuler</button>
          </div>
        </Modal>
      )}

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
