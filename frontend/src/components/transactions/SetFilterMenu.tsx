import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { NO_SET_FILTER, type SetFilter } from './useTransactionFilters';

export interface SetOption {
  value: string;
  label: string;
  color?: string;
  group?: string;
  hint?: string | null;
}

// Filtre multi-valeurs « à la logs » : coche une ou plusieurs valeurs, puis
// choisis de les garder (Seulement) ou de les écarter (Tout sauf).
export function SetFilterMenu({ label, allLabel, noneLabel, options, value, onChange }: {
  label: string;
  allLabel: string;
  /** Valeur « sans » (sans catégorie, sans tag), proposée en tête. */
  noneLabel?: string;
  options: SetOption[];
  value: SetFilter;
  onChange: (next: SetFilter) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const all = noneLabel ? [{ value: 'none', label: noneLabel }, ...options] : options;
  const nameOf = (id: string) => all.find((o) => o.value === id)?.label ?? id;
  const summary = value.ids.length === 0
    ? allLabel
    : `${value.mode === 'exclude' ? t('operations.except') + ' ' : ''}${value.ids.length === 1 ? nameOf(value.ids[0]!) : t('operations.n_selected', { n: value.ids.length })}`;
  const needle = search.trim().toLowerCase();
  const visible = all.filter((o) => !needle || o.label.toLowerCase().includes(needle));
  const toggle = (id: string, on: boolean) => {
    const ids = on ? [...value.ids, id] : value.ids.filter((x) => x !== id);
    onChange({ mode: value.mode, ids });
  };

  let lastGroup: string | undefined;
  return (
    <div className="jr-setfilter" ref={ref}>
      <button
        type="button"
        className={`jr-setfilter-btn${value.ids.length > 0 ? ' active' : ''}${value.mode === 'exclude' && value.ids.length > 0 ? ' exclude' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <span>{summary}</span> <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="jr-setfilter-pop" role="dialog" aria-label={label}>
          <div className="jr-seg" role="radiogroup" aria-label={t('operations.filter_mode')}>
            <button type="button" role="radio" aria-checked={value.mode === 'include'} className={value.mode === 'include' ? 'on' : ''} onClick={() => onChange({ ...value, mode: 'include' })}>{t('operations.only')}</button>
            <button type="button" role="radio" aria-checked={value.mode === 'exclude'} className={value.mode === 'exclude' ? 'on' : ''} onClick={() => onChange({ ...value, mode: 'exclude' })}>{t('operations.all_except')}</button>
          </div>
          {all.length > 8 && (
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('operations.filter_list_2')} aria-label={t('operations.filter_list')} autoFocus />
          )}
          <div className="jr-setfilter-list">
            {visible.map((o) => {
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={o.value}>
                  {header && <div className="jr-setfilter-group">{header}</div>}
                  <label className="jr-check" title={o.hint ?? undefined}>
                    <input type="checkbox" checked={value.ids.includes(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} />
                    {o.color && <i className="jr-dot" style={{ background: o.color }} aria-hidden="true" />}
                    <span>{o.label}</span>
                  </label>
                </div>
              );
            })}
            {visible.length === 0 && <p className="jr-note">{t('operations.no_results')}</p>}
          </div>
          <div className="jr-setfilter-foot">
            <button type="button" className="jr-link" disabled={value.ids.length === 0} onClick={() => onChange(NO_SET_FILTER)}>{t('operations.clear')}</button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>{t('operations.ok')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
