import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Tag } from '@suzanne/shared';
import { api, http } from '../lib/api';
import { money } from '../lib/format';
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
      <label className="full">{t('commun.name')}
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} placeholder={t('operations.italy_trip_john_s_wedding')} autoComplete="off" />
      </label>
      <label>{t('operations.color')}<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      <div className="st-preview">
        <span className="st-preview-label">{t('operations.preview')}</span>
        <span className="tag-chip" style={{ background: color }}>{name.trim() || t('operations.my_tag')}</span>
      </div>
      <div className="modal-actions full">
        <button type="button" className="secondary" onClick={onCancel}>{t('commun.cancel')}</button>
        <button className="primary">{submitLabel}</button>
      </div>
    </form>
  );
}

interface TagSummary { tag_id: number; count: number; expenses: number; income: number; first_date: string | null; last_date: string | null }

export function Tags({ userId, tags, run }: { userId: number; tags: Tag[]; run: Run }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  // Résumé par tag (toutes périodes), rechargé quand la liste change.
  const [summary, setSummary] = useState<Map<number, TagSummary>>(new Map());
  useEffect(() => {
    let cancelled = false;
    http<TagSummary[]>(`/users/${userId}/tags/summary`)
      .then((rows) => { if (!cancelled) setSummary(new Map(rows.map((r) => [r.tag_id, r]))); })
      .catch(() => { /* résumé facultatif */ });
    return () => { cancelled = true; };
  }, [userId, tags]);

  const create = (body: { name: string; color: string }) => {
    void run(() => api.createTag(userId, body), t('operations.tag_added')).then((ok) => { if (ok) setCreating(false); });
  };
  const update = (body: { name: string; color: string }) => {
    if (!editing) return;
    void run(() => api.updateTag(userId, editing.id, body), t('operations.tag_updated')).then((ok) => { if (ok) setEditing(null); });
  };

  return (
    <section className="st-page">
      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{tags.length}</strong> {tags.length > 1 ? t('operations.tags_2') : t('operations.tag')}
          <span className="st-sub">{t('operations.second_classification_on_top_category')}</span>
        </p>
        <button type="button" className="primary accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> {t('operations.new_tag')}
        </button>
      </div>

      <div className="panel st-list">
        <DataTable empty={tags.length === 0 ? t('operations.no_tags_yet') : null}>
          <thead><tr><th>{t('commun.name')}</th><th className="r">{t('operations.transactions')}</th><th className="r">{t('operations.spent')}</th><th className="r">{t('operations.received')}</th><th>{t('operations.period')}</th><th className="actions-cell"><span className="sr-only">{t('operations.actions')}</span></th></tr></thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.id}>
                <td className="cell-primary"><span className="tag-chip" style={{ background: tag.color }} title={tag.name}>{tag.name}</span></td>
                <td className="r num" data-label={t('operations.transactions')}>{summary.get(tag.id)?.count ?? 0}</td>
                <td className="r num expense" data-label={t('operations.spent')}>{summary.get(tag.id)?.expenses ? money(summary.get(tag.id)!.expenses) : '—'}</td>
                <td className="r num income" data-label={t('operations.received')}>{summary.get(tag.id)?.income ? money(summary.get(tag.id)!.income) : '—'}</td>
                <td className="st-muted" data-label={t('operations.period')}>{summary.get(tag.id)?.first_date
                  ? `${new Date(summary.get(tag.id)!.first_date!).toLocaleDateString(localeTag())} → ${new Date(summary.get(tag.id)!.last_date!).toLocaleDateString(localeTag())}`
                  : t('operations.created_on_d', { d: new Date(tag.created_at).toLocaleDateString(localeTag()) })}</td>
                <td className="actions-cell">
                  <IconButton label={t('operations.edit')} tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(tag)} />
                  <RowMenu items={[{
                    label: t('operations.delete'), icon: <Trash2 />, danger: true,
                    confirm: t('operations.delete_name_tag_transactions_carrying', { name: tag.name }),
                    onSelect: () => void run(() => api.deleteTag(userId, tag.id), t('operations.tag_deleted')),
                  }]} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>

      {creating && (
        <Modal title={t('operations.new_tag')} onClose={() => setCreating(false)}>
          <TagForm onSubmit={create} onCancel={() => setCreating(false)} submitLabel={t('operations.add')} />
        </Modal>
      )}
      {editing && (
        <Modal title={t('operations.edit_name', { name: editing.name })} onClose={() => setEditing(null)}>
          <TagForm key={editing.id} initial={editing} onSubmit={update} onCancel={() => setEditing(null)} submitLabel={t('operations.save')} />
        </Modal>
      )}
    </section>
  );
}
