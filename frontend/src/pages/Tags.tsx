import { FormEvent, useState } from 'react';
import { Pencil, Tag as TagIcon } from 'lucide-react';
import type { Tag } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

export function Tags({ userId, tags, run }: { userId: number; tags: Tag[]; run: Run }) {
  const [editing, setEditing] = useState<Tag | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => api.createTag(userId, {
      name: String(data.get('name')),
      color: String(data.get('color')),
    }), 'Tag ajouté');
    form.reset();
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.updateTag(userId, editing.id, {
      name: String(data.get('name')),
      color: String(data.get('color')),
    }), 'Tag modifié');
    setEditing(null);
  };

  return (
    <section className="split">
      <Panel title="Nouveau tag" sticky>
        <p className="panel-note">Les tags sont des étiquettes libres et multi-valeurs sur les transactions, indépendantes des catégories.</p>
        <form className="form" onSubmit={submit}>
          <label>Nom<input name="name" required maxLength={40} placeholder="Voyage Italie, Mariage Jean..." /></label>
          <label>Couleur<input name="color" type="color" defaultValue="#6366f1" /></label>
          <button className="primary"><TagIcon size={16} /> Ajouter</button>
        </form>
      </Panel>
      <Panel title="Tags" icon={<TagIcon />}>
        <DataTable empty={tags.length === 0 ? 'Aucun tag pour l\'instant.' : null}>
          <thead><tr><th>Nom</th><th>Couleur</th><th>Créé le</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {tags.map((t) => (
              <tr key={t.id}>
                <td><span className="tag-chip" style={{ background: t.color }}>{t.name}</span></td>
                <td><code>{t.color}</code></td>
                <td>{new Date(t.created_at).toLocaleDateString('fr-FR')}</td>
                <td className="actions-cell">
                  <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(t)} />
                  <IconButton label="Supprimer" confirm={`Supprimer le tag « ${t.name} » ? Les transactions qui le portent ne seront pas supprimées.`} onClick={() => void run(() => api.deleteTag(userId, t.id), 'Tag supprimé')} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>

      {editing && (
        <Modal title={`Modifier "${editing.name}"`} onClose={() => setEditing(null)}>
          <form className="form" onSubmit={submitEdit}>
            <label>Nom<input name="name" defaultValue={editing.name} required maxLength={40} /></label>
            <label>Couleur<input name="color" type="color" defaultValue={editing.color} /></label>
            <button className="primary">Enregistrer</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>Annuler</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
