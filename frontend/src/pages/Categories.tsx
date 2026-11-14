import { FormEvent, useState } from 'react';
import { GitMerge, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Category } from '@suzanne/shared';
import { api } from '../lib/api';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import type { Run } from '../lib/run';
import '../styles/pages/settings.css';

const DEFAULT_COLOR = '#6b8f00';

// Formulaire partagé création / modification (dans une modale).
function CategoryForm({ initial, onSubmit, onCancel, submitLabel }: {
  initial?: Category;
  onSubmit: (body: { name: string; type: Category['type']; color: string; icon: string; description: string }) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<Category['type']>(initial?.type ?? 'expense');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({
      name: String(data.get('name')).trim(),
      type,
      color: String(data.get('color')),
      icon: String(data.get('icon') || '').trim(),
      description: String(data.get('description') || '').trim(),
    });
  };
  return (
    <form className="form st-form" onSubmit={submit}>
      <label className="full">{t('commun.name')}<input name="name" defaultValue={initial?.name} required maxLength={60} autoComplete="off" /></label>
      <fieldset className="full st-segment">
        <legend>{t('operations.type')}</legend>
        <button type="button" className={type === 'expense' ? 'active' : ''} aria-pressed={type === 'expense'} onClick={() => setType('expense')}>{t('operations.expense')}</button>
        <button type="button" className={type === 'income' ? 'active' : ''} aria-pressed={type === 'income'} onClick={() => setType('income')}>{t('operations.income')}</button>
      </fieldset>
      <label>{t('operations.color')}<input name="color" type="color" defaultValue={initial?.color ?? DEFAULT_COLOR} /></label>
      <label>{t('operations.icon')}<input name="icon" defaultValue={initial?.icon ?? ''} placeholder="shopping-cart" /* i18n-ignore : nom d'icône */ autoComplete="off" /></label>
      <label className="full">{t('operations.description')}
        <textarea name="description" defaultValue={initial?.description ?? ''} rows={3} maxLength={500} placeholder={t('operations.what_category_covers_e_g')} />
        <small className="st-muted">{t('operations.shown_when_hovering_category_name')}</small>
      </label>
      <div className="modal-actions full">
        <button type="button" className="secondary" onClick={onCancel}>{t('commun.cancel')}</button>
        <button className="primary">{submitLabel}</button>
      </div>
    </form>
  );
}

export function Categories({ userId, categories, run }: { userId: number; categories: Category[]; run: Run }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [merging, setMerging] = useState<Category | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');

  const expenses = categories.filter((c) => c.type !== 'income');
  const incomes = categories.filter((c) => c.type === 'income');

  // Cibles de fusion possibles : autres catégories du même type (les revenus et
  // dépenses ne se mélangent pas, comme côté backend).
  const mergeTargets = merging ? categories.filter((c) => c.id !== merging.id && c.type === merging.type) : [];
  const startMerge = (category: Category) => { setMerging(category); setMergeTargetId(''); };
  const submitMerge = () => {
    if (!merging) return;
    const targetId = Number(mergeTargetId);
    if (!Number.isFinite(targetId) || targetId <= 0) return;
    const targetName = categories.find((c) => c.id === targetId)?.name ?? t('operations.the_target');
    void run(
      () => api.mergeCategory(userId, merging.id, targetId),
      t('operations.name_merged_into_target', { name: merging.name, target: targetName }),
    ).then((ok) => { if (ok) setMerging(null); });
  };

  const create = (body: { name: string; type: Category['type']; color: string; icon: string; description: string }) => {
    void run(() => api.createCategory(userId, body), t('operations.category_added'))
      .then((ok) => { if (ok) setCreating(false); });
  };
  const update = (body: { name: string; type: Category['type']; color: string; icon: string; description: string }) => {
    if (!editing) return;
    void run(() => api.updateCategory(userId, editing.id, body), t('operations.category_updated'))
      .then((ok) => { if (ok) setEditing(null); });
  };

  const table = (rows: Category[], empty: string) => (
    <DataTable empty={rows.length === 0 ? empty : null}>
      <thead><tr><th>{t('commun.name')}</th><th>{t('operations.description')}</th><th className="actions-cell"><span className="sr-only">{t('operations.actions')}</span></th></tr></thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id}>
            <td className="cell-primary">
              <span className="st-name">
                <span className="dot" style={{ background: c.color }} aria-hidden="true" />
                <strong title={c.name}>{c.name}</strong>
              </span>
            </td>
            <td className="st-muted st-desc" data-label={t('operations.description')}>{c.description || '—'}</td>
            <td className="actions-cell">
              <IconButton label={t('operations.edit')} tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(c)} />
              <RowMenu items={[
                { label: t('operations.merge_into_2'), icon: <GitMerge />, onSelect: () => startMerge(c) },
                {
                  label: t('operations.delete'), icon: <Trash2 />, danger: true,
                  // Irréversible : les transactions perdent leur catégorie.
                  confirm: t('operations.delete_name_category_its_transactions', { name: c.name }),
                  onSelect: () => void run(() => api.deleteCategory(userId, c.id), t('operations.category_deleted')),
                },
              ]} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );

  return (
    <section className="st-page">
      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{categories.length}</strong> {categories.length > 1 ? t('operations.categories') : t('operations.category')}
          <span className="st-sub">{expenses.length} {t('operations.expenses')}, {incomes.length} {t('operations.income_2')}</span>
        </p>
        <button type="button" className="primary accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> {t('operations.new_category')}
        </button>
      </div>

      <div className="st-columns">
        <div className="panel st-list">
          <h2 className="st-list-title">{t('commun.expenses')} <span>{expenses.length}</span></h2>
          {table(expenses, t('operations.no_expense_categories'))}
        </div>
        <div className="panel st-list">
          <h2 className="st-list-title">{t('commun.income')} <span>{incomes.length}</span></h2>
          {table(incomes, t('operations.no_income_categories'))}
        </div>
      </div>

      {creating && (
        <Modal title={t('operations.new_category')} onClose={() => setCreating(false)}>
          <CategoryForm onSubmit={create} onCancel={() => setCreating(false)} submitLabel={t('operations.add')} />
        </Modal>
      )}

      {editing && (
        <Modal title={t('operations.edit_name', { name: editing.name })} onClose={() => setEditing(null)}>
          <CategoryForm key={editing.id} initial={editing} onSubmit={update} onCancel={() => setEditing(null)} submitLabel={t('operations.save')} />
        </Modal>
      )}

      {merging && (
        <Modal title={t('operations.merge_name', { name: merging.name })} onClose={() => setMerging(null)}>
          <div className="form st-form">
            <p className="panel-note full">
              {t('operations.all_transactions_splits_budgets_recurrin', { name: merging.name })}
            </p>
            {mergeTargets.length === 0 ? (
              <p className="empty full">{merging.type === 'income' ? t('operations.no_other_income_category_available') : t('operations.no_other_expense_category_available')}</p>
            ) : (
              <label className="full">{t('operations.merge_into')}
                <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                  <option value="">{t('operations.choose_target_category')}</option>
                  {mergeTargets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setMerging(null)}>{t('commun.cancel')}</button>
              <button type="button" className="primary" disabled={!mergeTargetId} onClick={submitMerge}>{t('operations.merge')}</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
