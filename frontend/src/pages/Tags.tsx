import { FormEvent, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Tag } from '@suzanne/shared';
import { api } from '../lib/api';
import { localeTag } from '../i18n';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import type { Run } from '../lib/run';
import '../styles/pages/settings.css';

const DEFAULT_COLOR = '#4a6a00';

function TagForm({ initial, onSubmit, onCancel, submitLabel }: {
  initial?: Tag;
  onSubmit: (body: { name: string; color: string }) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_COLOR);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({ name: name.trim(), color });
  };
  return (
    <form className="form st-form" onSubmit={submit}>
      <label className="full">{t('Nom')}
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} placeholder={t('Voyage Italie, Mariage Jean...')} autoComplete="off" />
      </label>
      <label>{t('Couleur')}<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      <div className="st-preview">
        <span className="st-preview-label">{t('Aperçu')}</span>
        <span className="tag-chip" style={{ background: color }}>{name.trim() || t('Mon tag')}</span>
      </div>
      <div className="modal-actions full">
        <button type="button" className="secondary" onClick={onCancel}>{t('Annuler')}</button>
        <button className="primary">{submitLabel}</button>
      </div>
    </form>
  );
}

export function Tags({ userId, tags, run }: { userId: number; tags: Tag[]; run: Run }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);

  const create = (body: { name: string; color: string }) => {
    void run(() => api.createTag(userId, body), t('Tag ajouté')).then((ok) => { if (ok) setCreating(false); });
  };
  const update = (body: { name: string; color: string }) => {
    if (!editing) return;
    void run(() => api.updateTag(userId, editing.id, body), t('Tag modifié')).then((ok) => { if (ok) setEditing(null); });
  };

  return (
    <section className="st-page">
      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{tags.length}</strong> {tags.length > 1 ? t('tags') : t('tag')}
          <span className="st-sub">{t('étiquettes libres, en plus des catégories')}</span>
        </p>
        <button type="button" className="primary accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> {t('Nouveau tag')}
        </button>
      </div>

      <div className="panel st-list">
        <DataTable empty={tags.length === 0 ? t('Aucun tag pour l\'instant.') : null}>
          <thead><tr><th>{t('Nom')}</th><th>{t('Couleur')}</th><th>{t('Créé le')}</th><th className="actions-cell"><span className="sr-only">{t('Actions')}</span></th></tr></thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.id}>
                <td className="cell-primary"><span className="tag-chip" style={{ background: tag.color }} title={tag.name}>{tag.name}</span></td>
                <td className="st-muted" data-label={t('Couleur')}><code>{tag.color}</code></td>
                <td className="st-muted" data-label={t('Créé le')}>{new Date(tag.created_at).toLocaleDateString(localeTag())}</td>
                <td className="actions-cell">
                  <IconButton label={t('Modifier')} tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(tag)} />
                  <RowMenu items={[{
                    label: t('Supprimer'), icon: <Trash2 />, danger: true,
                    confirm: t('Supprimer le tag « {{name}} » ? Les transactions qui le portent ne seront pas supprimées.', { name: tag.name }),
                    onSelect: () => void run(() => api.deleteTag(userId, tag.id), t('Tag supprimé')),
                  }]} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>

      {creating && (
        <Modal title={t('Nouveau tag')} onClose={() => setCreating(false)}>
          <TagForm onSubmit={create} onCancel={() => setCreating(false)} submitLabel={t('Ajouter')} />
        </Modal>
      )}
      {editing && (
        <Modal title={t('Modifier « {{name}} »', { name: editing.name })} onClose={() => setEditing(null)}>
          <TagForm key={editing.id} initial={editing} onSubmit={update} onCancel={() => setEditing(null)} submitLabel={t('Enregistrer')} />
        </Modal>
      )}
    </section>
  );
}
