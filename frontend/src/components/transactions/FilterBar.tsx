import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { ACCOUNT_GROUPS, type Category, type Tag, type TransactionType } from '@suzanne/shared';
import { Modal } from '../Modal';
import { SetFilterMenu } from './SetFilterMenu';
import type { ClearedFilter, TransactionFiltersState, TxSortKey } from './useTransactionFilters';

// Recherche toujours visible ; les autres filtres en ligne sur desktop,
// derrière un bouton « Filtres (n) » sur mobile (feuille du bas).
export function FilterBar({ state, categories, tags, mobile, accounts = [] }: {
  state: TransactionFiltersState;
  categories: Category[];
  tags: Tag[];
  mobile: boolean;
  /** Comptes proposés individuellement (filtre « account:<id> »). */
  accounts?: Array<{ id: number; name: string; archived?: boolean }>;
}) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { filters, activeCount } = state;
  // La recherche est comptée à part (elle reste visible) dans le badge mobile.
  const hiddenCount = activeCount - (filters.query.trim() ? 1 : 0);

  const selects = (
    <>
      <select value={filters.type} onChange={(e) => state.setType(e.target.value as 'all' | TransactionType)} aria-label={t('operations.type_filter')}>
        <option value="all">{t('operations.all_types')}</option>
        <option value="expense">{t('commun.expenses')}</option>
        <option value="income">{t('commun.income')}</option>
        <option value="transfer">{t('operations.transfers')}</option>
      </select>
      <SetFilterMenu
        label={t('operations.category_filter')}
        allLabel={t('operations.all_categories')}
        noneLabel={t('operations.no_category')}
        options={[...categories].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'fr') : a.type === 'expense' ? -1 : 1))
          .map((c) => ({ value: String(c.id), label: c.name, color: c.color, group: c.type === 'income' ? t('commun.income') : t('commun.expenses'), hint: c.description }))}
        value={filters.categories}
        onChange={state.setCategories}
      />
      <select value={filters.accountGroup} onChange={(e) => state.setAccountGroup(e.target.value)} aria-label={t('operations.account_filter')}>
        <option value="all">{t('operations.all_accounts')}</option>
        <optgroup label={t('operations.by_type')}>
          {ACCOUNT_GROUPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
        {accounts.length > 0 && (
          <optgroup label={t('commun.by_account')}>
            {accounts.filter((a) => !a.archived || filters.accountGroup === `account:${a.id}`)
              .map((a) => <option key={a.id} value={`account:${a.id}`}>{a.name}</option>)}
          </optgroup>
        )}
      </select>
      {tags.length > 0 && (
        <SetFilterMenu
          label={t('operations.tag_filter')}
          allLabel={t('operations.all_tags')}
          noneLabel={t('operations.no_tag')}
          options={tags.map((tag) => ({ value: String(tag.id), label: tag.name, color: tag.color }))}
          value={filters.tags}
          onChange={state.setTags}
        />
      )}
      <select value={filters.cleared} onChange={(e) => state.setCleared(e.target.value as ClearedFilter)} aria-label={t('operations.cleared_filter')}>
        <option value="all">{t('operations.cleared_or_not')}</option>
        <option value="cleared">{t('operations.cleared')}</option>
        <option value="uncleared">{t('operations.uncleared')}</option>
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
        placeholder={t('operations.search_word_excludes')}
        title={t('operations.every_word_must_appear_word')}
        aria-label={t('operations.search_journal')}
      />
      {filters.query && (
        <button type="button" className="icon-ghost" onClick={() => state.setQuery('')} aria-label={t('operations.clear_search')}><X size={16} /></button>
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
            {t(activeCount > 1 ? 'operations.n_active_filters_reset' : 'operations.n_active_filter_reset', { n: activeCount })}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="jr-filters mobile">
      {search}
      <button type="button" className={`secondary jr-filter-toggle${hiddenCount > 0 ? ' active' : ''}`} onClick={() => setSheetOpen(true)} aria-label={t('operations.filters')}>
        <SlidersHorizontal size={16} />
        <span>{t('operations.filters')}</span>
        {hiddenCount > 0 && <span className="jr-count">{hiddenCount}</span>}
      </button>
      {sheetOpen && (
        <Modal title={t('operations.filters')} onClose={() => setSheetOpen(false)}>
          <div className="jr-form jr-filter-sheet">
            <label className="full">{t('operations.sort_by')}
              <select
                value={`${state.sort.key}:${state.sort.dir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(':') as [TxSortKey, 'asc' | 'desc'];
                  state.setSort({ key, dir });
                }}
              >
                <option value="date:desc">{t('operations.date_newest_first')}</option>
                <option value="date:asc">{t('operations.date_oldest_first')}</option>
                <option value="amount:desc">{t('operations.amount_largest_first')}</option>
                <option value="amount:asc">{t('operations.amount_smallest_first')}</option>
                <option value="label:asc">{t('operations.label_z')}</option>
              </select>
            </label>
            <div className="full jr-filter-stack">{selects}</div>
            <div className="jr-form-actions full">
              {activeCount > 0 && <button type="button" className="secondary" onClick={state.reset}>{t('operations.reset')}</button>}
              <span className="jr-spacer" />
              <button type="button" className="primary" onClick={() => setSheetOpen(false)}>
                {t('operations.view_n_transactions', { n: state.filtered.length })}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
