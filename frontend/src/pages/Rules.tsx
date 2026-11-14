import { FormEvent, useState } from 'react';
import { ArrowRight, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import type { Category, CategoryRule } from '@suzanne/shared';
import { api } from '../lib/api';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import type { Run } from '../lib/run';
import '../styles/pages/settings.css';
import { localeTag } from '../i18n';

type RuleBody = { pattern: string; category_id: number };

function RuleForm({ initial, categories, onSubmit, onCancel, submitLabel }: {
  initial?: CategoryRule;
  categories: Category[];
  onSubmit: (body: RuleBody) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
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
      <label className="full">Si le libellé contient
        <input name="pattern" defaultValue={initial?.pattern} placeholder="CARREFOUR" required autoComplete="off" autoCapitalize="characters" />
      </label>
      <label className="full">alors classer dans
        <select name="category_id" defaultValue={initial?.category_id ?? ''} required>
          <option value="" disabled>Choisir une catégorie…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <p className="panel-note full">S'applique aux imports, et aux opérations sans catégorie via « Appliquer ».</p>
      <div className="modal-actions full">
        <button type="button" className="secondary" onClick={onCancel}>Annuler</button>
        <button className="primary">{submitLabel}</button>
      </div>
    </form>
  );
}

export function Rules({ userId, rules, categories, categoryById, run }: {
  userId: number;
  rules: CategoryRule[];
  categories: Category[];
  categoryById: Map<number, Category>;
  run: Run;
}) {
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
      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{rules.length}</strong> règle{rules.length > 1 ? 's' : ''}
          <span className="st-sub">le mot-clé trouvé dans le libellé décide de la catégorie</span>
        </p>
        <div className="st-toolbar-actions">
          {rules.length > 0 && (
            <button type="button" className="secondary" onClick={applyAll}>
              <Wand2 size={16} /> Appliquer<span className="st-hide-sm">&nbsp;aux opérations sans catégorie</span>
            </button>
          )}
          <button type="button" className="primary accent" onClick={() => setCreating(true)} disabled={categories.length === 0}>
            <Plus size={16} /> Nouvelle règle
          </button>
        </div>
      </div>

      <div className="panel st-list">
        <DataTable empty={rules.length === 0 ? 'Aucune règle. Ajoute un mot-clé (ex. CARREFOUR) pour classer tes opérations automatiquement.' : null}>
          <thead><tr><th>Mot-clé</th><th>Catégorie</th><th>Créée le</th><th className="actions-cell"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rules.map((r) => {
              const category = categoryById.get(r.category_id);
              return (
                <tr key={r.id}>
                  <td className="cell-primary"><code className="st-pattern" title={r.pattern}>{r.pattern}</code><ArrowRight size={14} className="st-arrow" aria-hidden="true" /></td>
                  <td data-label="Catégorie">
                    <span className="st-name">
                      <span className="dot" style={{ background: category?.color ?? 'var(--faint)' }} aria-hidden="true" />
                      {category?.name ?? 'Catégorie supprimée'}
                    </span>
                  </td>
                  <td className="st-muted" data-label="Créée le">{new Date(r.created_at).toLocaleDateString(localeTag())}</td>
                  <td className="actions-cell">
                    <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(r)} />
                    <RowMenu items={[{ label: 'Supprimer', icon: <Trash2 />, danger: true, onSelect: () => remove(r) }]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </div>

      {creating && (
        <Modal title="Nouvelle règle" onClose={() => setCreating(false)}>
          <RuleForm categories={categories} onSubmit={create} onCancel={() => setCreating(false)} submitLabel="Enregistrer" />
        </Modal>
      )}
      {editing && (
        <Modal title="Modifier la règle" onClose={() => setEditing(null)}>
          <RuleForm key={editing.id} initial={editing} categories={categories} onSubmit={update} onCancel={() => setEditing(null)} submitLabel="Enregistrer" />
        </Modal>
      )}
    </section>
  );
}
