import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { ACCOUNT_GROUPS, type Category, type Tag, type TransactionType } from '@suzanne/shared';
import { Modal } from '../Modal';
import type { ClearedFilter, TransactionFiltersState, TxSortKey } from './useTransactionFilters';

// Recherche toujours visible ; les autres filtres en ligne sur desktop,
// derrière un bouton « Filtres (n) » sur mobile (feuille du bas).
export function FilterBar({ state, categories, tags, mobile }: {
  state: TransactionFiltersState;
  categories: Category[];
  tags: Tag[];
  mobile: boolean;
}) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { filters, activeCount } = state;
  // La recherche est comptée à part (elle reste visible) dans le badge mobile.
  const hiddenCount = activeCount - (filters.query.trim() ? 1 : 0);

  const selects = (
    <>
      <select value={filters.type} onChange={(e) => state.setType(e.target.value as 'all' | TransactionType)} aria-label={t('Filtre de type')}>
        <option value="all">{t('Tous les types')}</option>
        <option value="expense">{t('Dépenses')}</option>
        <option value="income">{t('Revenus')}</option>
        <option value="transfer">{t('Transferts')}</option>
      </select>
      <select value={filters.categoryId} onChange={(e) => state.setCategoryId(e.target.value)} aria-label={t('Filtre de catégorie')}>
        <option value="all">{t('Toutes les catégories')}</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select value={filters.accountGroup} onChange={(e) => state.setAccountGroup(e.target.value)} aria-label={t('Filtre de compte')}>
        <option value="all">{t('Tous les comptes')}</option>
        {ACCOUNT_GROUPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {tags.length > 0 && (
        <select value={filters.tagId} onChange={(e) => state.setTagId(e.target.value)} aria-label={t('Filtre de tag')}>
          <option value="all">{t('Tous les tags')}</option>
          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
      )}
      <select value={filters.cleared} onChange={(e) => state.setCleared(e.target.value as ClearedFilter)} aria-label={t('Filtre de pointage')}>
        <option value="all">{t('Pointées ou non')}</option>
        <option value="cleared">{t('Pointées')}</option>
        <option value="uncleared">{t('Non pointées')}</option>
      </select>
    </>
  );

  const search = (
    <div className="jr-search">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        value={filters.query}
        onChange={(e) => state.setQuery(e.target.value)}
        placeholder={t('Rechercher libellé, compte, montant…')}
        aria-label={t('Rechercher dans le journal')}
      />
      {filters.query && (
        <button type="button" className="icon-ghost" onClick={() => state.setQuery('')} aria-label={t('Effacer la recherche')}><X size={16} /></button>
      )}
    </div>
  );

  if (!mobile) {
    return (
      <div className="jr-filters">
        {search}
        {selects}
        {activeCount > 0 && (
          <button type="button" className="jr-link" onClick={state.reset}>
            {t(activeCount > 1 ? '{{n}} filtres actifs · Réinitialiser' : '{{n}} filtre actif · Réinitialiser', { n: activeCount })}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="jr-filters mobile">
      {search}
      <button type="button" className={`secondary jr-filter-toggle${hiddenCount > 0 ? ' active' : ''}`} onClick={() => setSheetOpen(true)} aria-label={t('Filtres')}>
        <SlidersHorizontal size={16} />
        <span>{t('Filtres')}</span>
        {hiddenCount > 0 && <span className="jr-count">{hiddenCount}</span>}
      </button>
      {sheetOpen && (
        <Modal title={t('Filtres')} onClose={() => setSheetOpen(false)}>
          <div className="jr-form jr-filter-sheet">
            <label className="full">{t('Trier par')}
              <select
                value={`${state.sort.key}:${state.sort.dir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(':') as [TxSortKey, 'asc' | 'desc'];
                  state.setSort({ key, dir });
                }}
              >
                <option value="date:desc">{t('Date, récentes d\'abord')}</option>
                <option value="date:asc">{t('Date, anciennes d\'abord')}</option>
                <option value="amount:desc">{t('Montant, du plus gros')}</option>
                <option value="amount:asc">{t('Montant, du plus petit')}</option>
                <option value="label:asc">{t('Libellé, A → Z')}</option>
              </select>
            </label>
            <div className="full jr-filter-stack">{selects}</div>
            <div className="jr-form-actions full">
              {activeCount > 0 && <button type="button" className="secondary" onClick={state.reset}>{t('Réinitialiser')}</button>}
              <span className="jr-spacer" />
              <button type="button" className="primary" onClick={() => setSheetOpen(false)}>
                {t('Voir {{n}} opérations', { n: state.filtered.length })}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
