import { FormEvent, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Wand2, X } from 'lucide-react';
import type { Category, CategoryRule } from '@suzanne/shared';
import { api } from '../lib/api';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';
import { Collapsible } from '../components/Collapsible';

import type { Run } from '../lib/run';

export function Rules({ userId, rules, categories, categoryById, run }: {
  userId: number;
  rules: CategoryRule[];
  categories: Category[];
  categoryById: Map<number, Category>;
  run: Run;
}) {
  const [addOpen, setAddOpen] = usePersistedState<boolean>('rules_add_open', rules.length === 0);
  // Édition inline d'une règle (mot-clé + catégorie).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPattern, setEditPattern] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const startEdit = (rule: CategoryRule) => {
    setEditingId(rule.id);
    setEditPattern(rule.pattern);
    setEditCategoryId(String(rule.category_id));
  };
  const saveEdit = (rule: CategoryRule) => {
    const pattern = editPattern.trim();
    const category_id = Number(editCategoryId);
    if (!pattern || !Number.isFinite(category_id) || category_id <= 0) return;
    void run(() => api.updateRule(userId, rule.id, { pattern, category_id }), 'Règle mise à jour')
      .then((ok) => { if (ok) setEditingId(null); });
  };
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
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouvelle règle</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={addOpen} className="collapsible-body">
            <p className="panel-note">Si le libellé d'une transaction contient le mot-clé, elle reçoit automatiquement la catégorie choisie. Appliquées à l'<strong>import CSV</strong>, et rétroactivement aux transactions sans catégorie via le bouton <strong>« Appliquer »</strong> ci-dessous.</p>
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">Mot-clé<input name="pattern" placeholder="CARREFOUR" required /></label>
              <label>Catégorie<select name="category_id" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <button className="primary"><Plus size={16} /> Enregistrer</button>
            </form>
          </Collapsible>
      </div>
      <Panel
        title="Règles"
        icon={<Wand2 />}
        action={rules.length > 0 ? (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (!window.confirm('Appliquer les règles à toutes les transactions sans catégorie ?')) return;
              void run(
                () => api.applyRules(userId),
                (result) => {
                  const { categorized } = result as { categorized: number };
                  return categorized > 0
                    ? `${categorized} transaction${categorized > 1 ? 's' : ''} catégorisée${categorized > 1 ? 's' : ''}`
                    : 'Aucune transaction sans catégorie à classer';
                },
              );
            }}
          >
            <Wand2 size={16} /> Appliquer aux transactions sans catégorie
          </button>
        ) : undefined}
      >
        <DataTable empty={rules.length === 0 ? 'Aucune règle.' : null}>
          <thead><tr><th>Mot-clé</th><th>Catégorie</th><th>Créée le</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                {editingId === r.id ? (
                  <>
                    <td>
                      <input
                        className="inline-amount-input"
                        value={editPattern}
                        autoFocus
                        onChange={(e) => setEditPattern(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(r); if (e.key === 'Escape') setEditingId(null); }}
                      />
                    </td>
                    <td>
                      <select className="inline-select" value={editCategoryId} onChange={(e) => setEditCategoryId(e.target.value)}>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>{new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="actions-cell">
                      <IconButton label="Valider" tone="accent" icon={<Check size={16} />} onClick={() => saveEdit(r)} />
                      <IconButton label="Annuler" tone="neutral" icon={<X size={16} />} onClick={() => setEditingId(null)} />
                    </td>
                  </>
                ) : (
                  <>
                    <td><strong>{r.pattern}</strong></td>
                    <td>{categoryById.get(r.category_id)?.name ?? 'Catégorie'}</td>
                    <td>{new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="actions-cell">
                      <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => startEdit(r)} />
                      <IconButton label="Supprimer" confirm={`Supprimer la règle « ${r.pattern} » ?`} onClick={() => void run(() => api.deleteRule(userId, r.id), 'Règle supprimée')} />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}
