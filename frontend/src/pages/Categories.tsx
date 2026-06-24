import { FormEvent, useState } from 'react';
import { ChevronDown, ChevronUp, FolderTree, GitMerge, Pencil, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Category } from '@suzanne/shared';
import { api } from '../lib/api';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { Collapsible } from '../components/Collapsible';

import type { Run } from '../lib/run';

export function Categories({ userId, categories, run }: { userId: number; categories: Category[]; run: Run }) {
  const { t } = useTranslation();
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
    const targetName = categories.find((c) => c.id === targetId)?.name ?? t('la cible');
    void run(
      () => api.mergeCategory(userId, merging.id, targetId),
      t('« {{name}} » fusionnée dans « {{target}} »', { name: merging.name, target: targetName }),
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
    }), t('Catégorie mise à jour'));
    setEditing(null);
  };

  return (
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> {t('Nouvelle catégorie')}</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={addOpen} className="collapsible-body">
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">{t('Nom')}<input name="name" required /></label>
              <label>{t('Type')}<select name="type"><option value="expense">{t('Dépense')}</option><option value="income">{t('Revenu')}</option></select></label>
              <label>{t('Couleur')}<input name="color" type="color" defaultValue="#6366f1" /></label>
              <label>{t('Icône')}<input name="icon" placeholder="shopping-cart" /></label>
              <button className="primary"><Plus size={16} /> {t('Ajouter')}</button>
            </form>
          </Collapsible>
      </div>
      <Panel title={t('Catégories')} icon={<FolderTree />}>
        <DataTable empty={categories.length === 0 ? t('Aucune catégorie.') : null}>
          <thead><tr><th>{t('Nom')}</th><th>{t('Type')}</th><th>{t('Icône')}</th><th className="actions-cell">{t('Actions')}</th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td><span className="dot inline" style={{ background: c.color }} /><strong title={c.name}>{c.name}</strong></td>
                <td><span className={`pill ${c.type}`}>{c.type === 'income' ? t('Revenu') : t('Dépense')}</span></td>
                <td>{c.icon ?? '-'}</td>
                <td className="actions-cell">
                  <IconButton label={t('Modifier')} tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(c)} />
                  <IconButton label={t('Fusionner dans une autre catégorie')} tone="neutral" icon={<GitMerge size={16} />} onClick={() => startMerge(c)} />
                  <IconButton label={t('Supprimer')} confirm={t('Supprimer la catégorie « {{name}} » ? Ses transactions resteront mais perdront leur catégorie.', { name: c.name })} onClick={() => void run(() => api.deleteCategory(userId, c.id), t('Catégorie supprimée'))} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>

      {merging && (
        <Modal title={t('Fusionner « {{name}} »', { name: merging.name })} onClose={() => setMerging(null)}>
          <div className="form">
            <p className="panel-note">
              {t('Toutes les transactions, ventilations, budgets, récurrents, règles et factures de « {{name}} » seront réaffectés à la catégorie cible, puis « {{name}} » sera supprimée. Action irréversible.', { name: merging.name })}
            </p>
            {mergeTargets.length === 0 ? (
              <p className="empty">{merging.type === 'income' ? t('Aucune autre catégorie de revenu disponible.') : t('Aucune autre catégorie de dépense disponible.')}</p>
            ) : (
              <label>{t('Fusionner dans')}
                <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)} autoFocus>
                  <option value="">{t('Choisir la catégorie cible…')}</option>
                  {mergeTargets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <button className="primary" disabled={!mergeTargetId} onClick={submitMerge}>{t('Fusionner')}</button>
            <button type="button" className="secondary" onClick={() => setMerging(null)}>{t('Annuler')}</button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={t('Modifier « {{name}} »', { name: editing.name })} onClose={() => setEditing(null)}>
          <form className="form" onSubmit={submitEdit} key={editing.id}>
            <label>{t('Nom')}<input name="name" defaultValue={editing.name} required /></label>
            <label>{t('Type')}
              <select name="type" defaultValue={editing.type}>
                <option value="expense">{t('Dépense')}</option>
                <option value="income">{t('Revenu')}</option>
              </select>
            </label>
            <label>{t('Couleur')}<input name="color" type="color" defaultValue={editing.color} /></label>
            <label>{t('Icône')}<input name="icon" defaultValue={editing.icon ?? ''} placeholder="shopping-cart" /></label>
            <button className="primary">{t('Enregistrer')}</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>{t('Annuler')}</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
