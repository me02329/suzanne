import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import type { Category, CategoryRule, Tag, TagRule } from '@suzanne/shared';
import { api } from '../lib/api';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import type { Run } from '../lib/run';
import '../styles/pages/settings.css';
import { localeTag } from '../i18n';
import { useTranslation } from 'react-i18next';

type RuleBody = { pattern: string; category_id: number };

function RuleForm({ initial, categories, onSubmit, onCancel, submitLabel }: {
  initial?: CategoryRule;
  categories: Category[];
  onSubmit: (body: RuleBody) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const { t } = useTranslation();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const pattern = String(data.get('pattern')).trim();
    const category_id = Number(data.get('category_id'));
    if (!pattern || !Number.isFinite(category_id) || category_id <= 0) return;
    onSubmit({ pattern, category_id });
  };
  return (
    <form className="form st-form" onSubmit={submit}>
      <label className="full">{t('operations.rules.if_label_contains')}
        <input name="pattern" defaultValue={initial?.pattern} placeholder="CARREFOUR" /* i18n-ignore */ required autoComplete="off" autoCapitalize="characters" />
      </label>
      <label className="full">{t('operations.rules.then_file_under')}
        <select name="category_id" defaultValue={initial?.category_id ?? ''} required>
          <option value="" disabled>{t('operations.rules.choose_category')}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <p className="panel-note full">{t('operations.rules.applies_to_imports_and_to')}</p>
      <div className="modal-actions full">
        <button type="button" className="secondary" onClick={onCancel}>{t('operations.rules.cancel')}</button>
        <button className="primary">{submitLabel}</button>
      </div>
    </form>
  );
}

export function Rules({ userId, rules, categories, categoryById, tags = [], dataVersion = 0, run }: {
  userId: number;
  rules: CategoryRule[];
  categories: Category[];
  categoryById: Map<number, Category>;
  tags?: Tag[];
  dataVersion?: number;
  run: Run;
}) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CategoryRule | null>(null);

  const create = (body: RuleBody) => {
    void run(() => api.setRule(userId, body), 'Règle enregistrée').then((ok) => { if (ok) setCreating(false); });
  };
  const update = (body: RuleBody) => {
    if (!editing) return;
    void run(() => api.updateRule(userId, editing.id, body), 'Règle mise à jour').then((ok) => { if (ok) setEditing(null); });
  };
  // Une règle supprimée se recrée à l'identique : suppression annulable, sans confirmation.
  const remove = (rule: CategoryRule) => {
    void run(() => api.deleteRule(userId, rule.id), 'Règle supprimée', {
      undo: () => api.setRule(userId, { pattern: rule.pattern, category_id: rule.category_id }),
    });
  };
  const applyAll = () => {
    if (!window.confirm('Appliquer les règles à toutes les opérations sans catégorie ?')) return;
    void run(
      () => api.applyRules(userId),
      (result) => {
        const { categorized } = result as { categorized: number };
        return categorized > 0
          ? `${categorized} opération${categorized > 1 ? 's' : ''} catégorisée${categorized > 1 ? 's' : ''}`
          : 'Aucune opération sans catégorie à classer';
      },
    );
  };

  return (
    <section className="st-page">
      <TagRulesPanel userId={userId} tags={tags} dataVersion={dataVersion} run={run} />

      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{rules.length}</strong>  {t('operations.rules.rule')}{rules.length > 1 ? 's' : ''}
          <span className="st-sub">{t('operations.rules.the_keyword_found_in_label')}</span>
        </p>
        <div className="st-toolbar-actions">
          {rules.length > 0 && (
            <button type="button" className="secondary" onClick={applyAll}>
              <Wand2 size={16} />  {t('operations.rules.apply')}<span className="st-hide-sm">{t('operations.rules.to_uncategorised_transactions')}</span>
            </button>
          )}
          <button type="button" className="primary accent" onClick={() => setCreating(true)} disabled={categories.length === 0}>
            <Plus size={16} />  {t('operations.rules.new_rule')}
          </button>
        </div>
      </div>

      <div className="panel st-list">
        <DataTable empty={rules.length === 0 ? 'Aucune règle. Ajoute un mot-clé (ex. CARREFOUR) pour classer tes opérations automatiquement.' : null}>
          <thead><tr><th>{t('operations.rules.keyword')}</th><th>{t('operations.rules.category')}</th><th>{t('operations.rules.created_on')}</th><th className="actions-cell"><span className="sr-only">{t('operations.rules.actions')}</span></th></tr></thead>
          <tbody>
            {rules.map((r) => {
              const category = categoryById.get(r.category_id);
              return (
                <tr key={r.id}>
                  <td className="cell-primary"><code className="st-pattern" title={r.pattern}>{r.pattern}</code><ArrowRight size={14} className="st-arrow" aria-hidden="true" /></td>
                  <td data-label={t('operations.rules.category')}>
                    <span className="st-name">
                      <span className="dot" style={{ background: category?.color ?? 'var(--faint)' }} aria-hidden="true" />
                      {category?.name ?? 'Catégorie supprimée'}
                    </span>
                  </td>
                  <td className="st-muted" data-label={t('operations.rules.created_on')}>{new Date(r.created_at).toLocaleDateString(localeTag())}</td>
                  <td className="actions-cell">
                    <IconButton label={t('operations.rules.edit')} tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(r)} />
                    <RowMenu items={[{ label: 'Supprimer', icon: <Trash2 />, danger: true, onSelect: () => remove(r) }]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </div>

      {creating && (
        <Modal title={t('operations.rules.new_rule')} onClose={() => setCreating(false)}>
          <RuleForm categories={categories} onSubmit={create} onCancel={() => setCreating(false)} submitLabel="Enregistrer" />
        </Modal>
      )}
      {editing && (
        <Modal title={t('operations.rules.edit_rule')} onClose={() => setEditing(null)}>
          <RuleForm key={editing.id} initial={editing} categories={categories} onSubmit={update} onCancel={() => setEditing(null)} submitLabel="Enregistrer" />
        </Modal>
      )}
    </section>
  );
}

// Règles de tag : libellé contenant le mot-clé → tag. Plusieurs règles peuvent
// poser plusieurs tags ; appliquées à l'import et via « Appliquer ».
function TagRulesPanel({ userId, tags, dataVersion, run }: { userId: number; tags: Tag[]; dataVersion: number; run: Run }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<TagRule[]>([]);
  const [creating, setCreating] = useState(false);
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));

  useEffect(() => {
    let cancelled = false;
    api.tagRules(userId).then((rows) => { if (!cancelled) setRules(rows); }).catch(() => { /* liste facultative */ });
    return () => { cancelled = true; };
  }, [userId, dataVersion]);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const pattern = String(data.get('pattern')).trim();
    const tag_id = Number(data.get('tag_id'));
    if (!pattern || !(tag_id > 0)) return;
    void run(() => api.createTagRule(userId, { pattern, tag_id }), t('reglages.rules_tag.saved')).then((ok) => { if (ok) setCreating(false); });
  };
  const remove = (rule: TagRule) => {
    void run(() => api.deleteTagRule(userId, rule.id), t('reglages.rules_tag.deleted'), {
      undo: () => api.createTagRule(userId, { pattern: rule.pattern, tag_id: rule.tag_id }),
    });
  };
  const applyAll = () => {
    void run(
      () => api.applyTagRules(userId),
      (result) => {
        const { tagged } = result as { tagged: number };
        return tagged > 0 ? t('reglages.rules_tag.applied', { count: tagged }) : t('reglages.rules_tag.applied_none');
      },
    );
  };

  return (
    <div className="panel st-list st-tag-rules">
      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{rules.length}</strong> {t('reglages.rules_tag.count', { count: rules.length })}
          <span className="st-sub">{t('reglages.rules_tag.explain')}</span>
        </p>
        <div className="st-toolbar-actions">
          {rules.length > 0 && (
            <button type="button" className="secondary" onClick={applyAll}>
              <Wand2 size={16} /> {t('reglages.rules_tag.apply')}
            </button>
          )}
          <button type="button" className="secondary" onClick={() => setCreating(true)} disabled={tags.length === 0} title={tags.length === 0 ? t('reglages.rules_tag.no_tag_yet') : undefined}>
            <Plus size={16} /> {t('reglages.rules_tag.new')}
          </button>
        </div>
      </div>
      <DataTable empty={rules.length === 0 ? t('reglages.rules_tag.empty') : null}>
        <thead><tr><th>{t('reglages.rules_tag.keyword')}</th><th>{t('reglages.rules_tag.tag')}</th><th className="actions-cell"><span className="sr-only">{t('reglages.rules_tag.actions')}</span></th></tr></thead>
        <tbody>
          {rules.map((r) => {
            const tag = tagById.get(r.tag_id);
            return (
              <tr key={r.id}>
                <td className="cell-primary"><code className="st-pattern" title={r.pattern}>{r.pattern}</code><ArrowRight size={14} className="st-arrow" aria-hidden="true" /></td>
                <td data-label={t('reglages.rules_tag.tag')}>
                  {tag ? <span className="tag-chip" style={{ background: tag.color }}>{tag.name}</span> : <span className="st-muted">—</span>}
                </td>
                <td className="actions-cell">
                  <IconButton label={t('reglages.rules_tag.delete')} icon={<Trash2 size={16} />} onClick={() => remove(r)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      {creating && (
        <Modal title={t('reglages.rules_tag.new')} onClose={() => setCreating(false)}>
          <form className="form st-form" onSubmit={create}>
            <label className="full">{t('operations.rules.if_label_contains')}
              <input name="pattern" placeholder="SNCF" /* i18n-ignore */ required autoComplete="off" autoCapitalize="characters" autoFocus />
            </label>
            <label className="full">{t('reglages.rules_tag.then_add_tag')}
              <select name="tag_id" defaultValue="" required>
                <option value="" disabled>{t('reglages.rules_tag.choose_tag')}</option>
                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
            <p className="panel-note full">{t('reglages.rules_tag.form_note')}</p>
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setCreating(false)}>{t('reglages.rules_tag.cancel')}</button>
              <button className="primary">{t('reglages.rules_tag.save')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
