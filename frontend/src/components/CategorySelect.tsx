import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Category } from '@suzanne/shared';
import { CategoryIcon } from '../lib/categoryIcons';
import '../styles/components/category-select.css';

// Liste de choix de catégorie, à la place d'un <select> natif : un menu natif
// n'affiche aucune infobulle au survol de ses options, donc pas la description
// des catégories. Même interface qu'un <select> contrôlé (valeur texte, '' =
// aucune) pour remplacer l'existant sans toucher à la logique autour.
// Clavier : flèches, Entrée, Échap, saisie pour filtrer.
export function CategorySelect({
  value, onChange, categories, noneLabel, ariaLabel, disabled = false, className, title,
}: {
  value: string;
  onChange: (value: string) => void;
  categories: Category[];
  noneLabel: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; above: boolean } | null>(null);
  const selected = categories.find((c) => String(c.id) === value) ?? null;

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const options = useMemo(() => {
    const q = norm(query.trim());
    const list = q ? categories.filter((c) => norm(c.name).includes(q) || norm(c.description ?? '').includes(q)) : categories;
    return [null, ...list] as Array<Category | null>; // null = « aucune »
  }, [categories, query]);

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 260);
    const above = rect.bottom + 340 > window.innerHeight && rect.top > 340;
    setPos({ left: Math.min(rect.left, window.innerWidth - width - 8), top: above ? rect.top - 6 : rect.bottom + 6, width, above });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const reposition = () => place();
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, categories.findIndex((c) => String(c.id) === value) + 1));
    setOpen(true);
  };
  const pick = (c: Category | null) => {
    onChange(c ? String(c.id) : '');
    setOpen(false);
    buttonRef.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(options[active] ?? null); }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); if (e.key === 'Escape') buttonRef.current?.focus(); }
  };
  useEffect(() => {
    if (open) popRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const current = options[active] ?? null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={['cat-select', className, disabled ? 'disabled' : ''].filter(Boolean).join(' ')}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openMenu(); } }}
      >
        {selected && <span className="cat-select-dot" style={{ background: selected.color }} aria-hidden />}
        {selected && <CategoryIcon name={selected.icon} size={14} className="cat-select-icon" color={selected.color} />}
        <span className={selected ? 'cat-select-label' : 'cat-select-label placeholder'}>{selected?.name ?? noneLabel}</span>
        <ChevronDown size={14} className="cat-select-chevron" aria-hidden />
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className={`cat-select-pop${pos.above ? ' above' : ''}`}
          style={{ left: pos.left, top: pos.top, width: pos.width }}
          onKeyDown={onKey}
        >
          <input
            className="cat-select-search"
            autoFocus
            value={query}
            placeholder={t('ui.category_select.search')}
            aria-label={t('ui.category_select.search')}
            aria-controls={listId}
            onChange={(e) => { setQuery(e.target.value); setActive(e.target.value ? 1 : 0); }}
          />
          <ul id={listId} role="listbox" aria-label={ariaLabel} className="cat-select-list">
            {options.map((c, i) => (
              <li
                key={c?.id ?? 'none'}
                role="option"
                data-index={i}
                aria-selected={c ? String(c.id) === value : value === ''}
                className={['cat-select-option', i === active ? 'active' : '', (c ? String(c.id) === value : value === '') ? 'selected' : ''].filter(Boolean).join(' ')}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
              >
                {c ? (
                  <>
                    <span className="cat-select-dot" style={{ background: c.color }} aria-hidden />
                    <CategoryIcon name={c.icon} size={14} className="cat-select-icon" color={c.color} />
                    <span className="cat-select-label">{c.name}</span>
                  </>
                ) : <span className="cat-select-label placeholder">{noneLabel}</span>}
              </li>
            ))}
            {options.length === 1 && query && <li className="cat-select-empty">{t('ui.category_select.no_match')}</li>}
          </ul>
          {/* Description de la catégorie survolée / active : ce qu'un menu natif ne peut pas montrer. */}
          <div className="cat-select-desc" aria-live="polite">
            {current?.description
              ? <><strong>{current.name}</strong><span>{current.description}</span></>
              : <span className="cat-select-desc-empty">{current ? t('ui.category_select.no_description') : t('ui.category_select.hint')}</span>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
