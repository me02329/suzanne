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
  onSubmit: (body: { name: string; type: Category['type']; color: string; icon: string }) => void;
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
    });
  };
  return (
    <form className="form st-form" onSubmit={submit}>
      <label className="full">{t('Nom')}<input name="name" defaultValue={initial?.name} required maxLength={60} autoComplete="off" /></label>
      <fieldset className="full st-segment">
        <legend>{t('Type')}</legend>
        <button type="button" className={type === 'expense' ? 'active' : ''} aria-pressed={type === 'expense'} onClick={() => setType('expense')}>{t('Dépense')}</button>
        <button type="button" className={type === 'income' ? 'active' : ''} aria-pressed={type === 'income'} onClick={() => setType('income')}>{t('Revenu')}</button>
      </fieldset>
      <label>{t('Couleur')}<input name="color" type="color" defaultValue={initial?.color ?? DEFAULT_COLOR} /></label>
      <label>{t('Icône')}<input name="icon" defaultValue={initial?.icon ?? ''} placeholder="shopping-cart" autoComplete="off" /></label>
      <div className="modal-actions full">
        <button type="button" className="secondary" onClick={onCancel}>{t('Annuler')}</button>
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
    const targetName = categories.find((c) => c.id === targetId)?.name ?? t('la cible');
    void run(
      () => api.mergeCategory(userId, merging.id, targetId),
      t('« {{name}} » fusionnée dans « {{target}} »', { name: merging.name, target: targetName }),
    ).then((ok) => { if (ok) setMerging(null); });
  };

  const create = (body: { name: string; type: Category['type']; color: string; icon: string }) => {
    void run(() => api.createCategory(userId, body), t('Catégorie ajoutée'))
      .then((ok) => { if (ok) setCreating(false); });
  };
  const update = (body: { name: string; type: Category['type']; color: string; icon: string }) => {
    if (!editing) return;
    void run(() => api.updateCategory(userId, editing.id, body), t('Catégorie mise à jour'))
      .then((ok) => { if (ok) setEditing(null); });
  };

  const table = (rows: Category[], empty: string) => (
    <DataTable empty={rows.length === 0 ? empty : null}>
      <thead><tr><th>{t('Nom')}</th><th>{t('Icône')}</th><th className="actions-cell"><span className="sr-only">{t('Actions')}</span></th></tr></thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id}>
            <td className="cell-primary">
              <span className="st-name">
                <span className="dot" style={{ background: c.color }} aria-hidden="true" />
                <strong title={c.name}>{c.name}</strong>
              </span>
            </td>
            <td className="st-muted" data-label={t('Icône')}>{c.icon || '—'}</td>
            <td className="actions-cell">
              <IconButton label={t('Modifier')} tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(c)} />
              <RowMenu items={[
                { label: t('Fusionner dans…'), icon: <GitMerge />, onSelect: () => startMerge(c) },
                {
                  label: t('Supprimer'), icon: <Trash2 />, danger: true,
                  // Irréversible : les transactions perdent leur catégorie.
                  confirm: t('Supprimer la catégorie « {{name}} » ? Ses transactions resteront mais perdront leur catégorie.', { name: c.name }),
                  onSelect: () => void run(() => api.deleteCategory(userId, c.id), t('Catégorie supprimée')),
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
          <strong>{categories.length}</strong> {categories.length > 1 ? t('catégories') : t('catégorie')}
          <span className="st-sub">{expenses.length} {t('dépenses')}, {incomes.length} {t('revenus')}</span>
        </p>
        <button type="button" className="primary accent" onClick={() => setCreating(true)}>
          <Plus size={16} /> {t('Nouvelle catégorie')}
        </button>
      </div>

      <div className="st-columns">
        <div className="panel st-list">
          <h2 className="st-list-title">{t('Dépenses')} <span>{expenses.length}</span></h2>
          {table(expenses, t('Aucune catégorie de dépense.'))}
        </div>
        <div className="panel st-list">
          <h2 className="st-list-title">{t('Revenus')} <span>{incomes.length}</span></h2>
          {table(incomes, t('Aucune catégorie de revenu.'))}
        </div>
      </div>

      {creating && (
        <Modal title={t('Nouvelle catégorie')} onClose={() => setCreating(false)}>
          <CategoryForm onSubmit={create} onCancel={() => setCreating(false)} submitLabel={t('Ajouter')} />
        </Modal>
      )}

      {editing && (
        <Modal title={t('Modifier « {{name}} »', { name: editing.name })} onClose={() => setEditing(null)}>
          <CategoryForm key={editing.id} initial={editing} onSubmit={update} onCancel={() => setEditing(null)} submitLabel={t('Enregistrer')} />
        </Modal>
      )}

      {merging && (
        <Modal title={t('Fusionner « {{name}} »', { name: merging.name })} onClose={() => setMerging(null)}>
          <div className="form st-form">
            <p className="panel-note full">
              {t('Toutes les transactions, ventilations, budgets, récurrents, règles et factures de « {{name}} » seront réaffectés à la catégorie cible, puis « {{name}} » sera supprimée. Action irréversible.', { name: merging.name })}
            </p>
            {mergeTargets.length === 0 ? (
              <p className="empty full">{merging.type === 'income' ? t('Aucune autre catégorie de revenu disponible.') : t('Aucune autre catégorie de dépense disponible.')}</p>
            ) : (
              <label className="full">{t('Fusionner dans')}
                <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                  <option value="">{t('Choisir la catégorie cible…')}</option>
                  {mergeTargets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setMerging(null)}>{t('Annuler')}</button>
              <button type="button" className="primary" disabled={!mergeTargetId} onClick={submitMerge}>{t('Fusionner')}</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
