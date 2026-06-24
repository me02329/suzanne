import { FormEvent, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil, Plus, Tag as TagIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Tag } from '@suzanne/shared';
import { api } from '../lib/api';
import { localeTag } from '../i18n';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { Collapsible } from '../components/Collapsible';

import type { Run } from '../lib/run';

export function Tags({ userId, tags, run }: { userId: number; tags: Tag[]; run: Run }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Tag | null>(null);
  const [addOpen, setAddOpen] = usePersistedState<boolean>('tags_add_open', tags.length === 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => api.createTag(userId, {
      name: String(data.get('name')),
      color: String(data.get('color')),
    }), t('Tag ajouté'));
    form.reset();
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.updateTag(userId, editing.id, {
      name: String(data.get('name')),
      color: String(data.get('color')),
    }), t('Tag modifié'));
    setEditing(null);
  };

  return (
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> {t('Nouveau tag')}</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={addOpen} className="collapsible-body">
            <p className="panel-note">{t('Les tags sont des étiquettes libres et multi-valeurs sur les transactions, indépendantes des catégories.')}</p>
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">{t('Nom')}<input name="name" required maxLength={40} placeholder={t('Voyage Italie, Mariage Jean...')} /></label>
              <label>{t('Couleur')}<input name="color" type="color" defaultValue="#6366f1" /></label>
              <button className="primary"><TagIcon size={16} /> {t('Ajouter')}</button>
            </form>
          </Collapsible>
      </div>
      <Panel title={t('Tags')} icon={<TagIcon />}>
        <DataTable empty={tags.length === 0 ? t('Aucun tag pour l\'instant.') : null}>
          <thead><tr><th>{t('Nom')}</th><th>{t('Couleur')}</th><th>{t('Créé le')}</th><th className="actions-cell">{t('Actions')}</th></tr></thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.id}>
                <td><span className="tag-chip" style={{ background: tag.color }} title={tag.name}>{tag.name}</span></td>
                <td><code>{tag.color}</code></td>
                <td>{new Date(tag.created_at).toLocaleDateString(localeTag())}</td>
                <td className="actions-cell">
                  <IconButton label={t('Modifier')} tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(tag)} />
                  <IconButton label={t('Supprimer')} confirm={t('Supprimer le tag « {{name}} » ? Les transactions qui le portent ne seront pas supprimées.', { name: tag.name })} onClick={() => void run(() => api.deleteTag(userId, tag.id), t('Tag supprimé'))} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>

      {editing && (
        <Modal title={t('Modifier « {{name}} »', { name: editing.name })} onClose={() => setEditing(null)}>
          <form className="form" onSubmit={submitEdit}>
            <label>{t('Nom')}<input name="name" defaultValue={editing.name} required maxLength={40} /></label>
            <label>{t('Couleur')}<input name="color" type="color" defaultValue={editing.color} /></label>
            <button className="primary">{t('Enregistrer')}</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>{t('Annuler')}</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
