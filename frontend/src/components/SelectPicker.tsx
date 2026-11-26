import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useClampToViewport } from '../lib/useClampToViewport';
import '../styles/components/category-select.css';

// Listes déroulantes de l'app : toutes les <select> gardent leur place, leur
// style et leur rôle dans les formulaires, mais leur fenêtre de choix est celle
// de l'app (panneau depuis le bas sur téléphone, menu sous le champ sinon) au
// lieu de la liste du système. Monté une fois (App) ; s'applique à toute
// <select> simple. Exception : data-native sur l'élément.

interface Item { value: string; label: string; disabled: boolean; group: string | null }

const SEARCH_FROM = 9; // recherche au-delà de ce nombre de choix

const isEnhanced = (el: EventTarget | null): el is HTMLSelectElement =>
  el instanceof HTMLSelectElement && !el.multiple && !el.disabled && !el.hasAttribute('data-native') && el.size <= 1;

function itemsOf(select: HTMLSelectElement): Item[] {
  return Array.from(select.options).map((o) => ({
    value: o.value,
    label: (o.label || o.textContent || '').trim(),
    disabled: o.disabled,
    group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : null,
  }));
}

function titleOf(select: HTMLSelectElement): string {
  const aria = select.getAttribute('aria-label');
  if (aria) return aria;
  const label = select.labels?.[0];
  if (label) {
    // Texte du libellé sans celui de la liste elle-même (souvent dedans).
    const clone = label.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('select, input, textarea, button, small, .hint').forEach((n) => n.remove());
    const text = clone.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

/** Choisit une valeur comme le ferait l'utilisateur : React reçoit un vrai onChange. */
function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

export function SelectPicker() {
  const { t } = useTranslation();
  const [target, setTarget] = useState<HTMLSelectElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState('');
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = target !== null;
  useClampToViewport(popRef, target !== null && !sheet, [pos]);

  // Ouverture : toucher / clic / clavier sur une <select>, à la place de la
  // liste du système.
  useEffect(() => {
    const open = (select: HTMLSelectElement) => {
      const mobile = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
      const r = select.getBoundingClientRect();
      setItems(itemsOf(select));
      setCurrent(select.value);
      setQuery('');
      setSheet(mobile);
      setPos({ left: r.left, top: r.bottom + 6, width: Math.max(r.width, 220) });
      setTarget(select);
      select.focus({ preventScroll: true });
    };
    const onPointer = (event: Event) => {
      if (!isEnhanced(event.target)) return;
      event.preventDefault(); // pas de liste du système
      if (event.type === 'pointerdown' || event.type === 'mousedown') return; // ouverture au clic (évite le double)
      if (!openRef.current) open(event.target);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!isEnhanced(event.target) || openRef.current) return;
      if (event.key === 'Enter' || event.key === ' ' || (event.key === 'ArrowDown' && event.altKey) || event.key === 'F4') {
        event.preventDefault();
        open(event.target);
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('mousedown', onPointer, true);
    document.addEventListener('click', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('mousedown', onPointer, true);
      document.removeEventListener('click', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const close = (restoreFocus = true) => {
    const select = target;
    setTarget(null);
    if (restoreFocus) select?.focus({ preventScroll: true });
  };

  // Fermeture : toucher ailleurs, Échap, défilement de la page (menu), largeur changée.
  useEffect(() => {
    if (!target) return;
    const onDown = (event: PointerEvent) => {
      if (popRef.current?.contains(event.target as Node)) return;
      if (event.target === target) return;
      close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    };
    const onScroll = (event: Event) => { if (!sheet && !popRef.current?.contains(event.target as Node)) close(false); };
    const width = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== width) close(false); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, sheet]);

  // Le choix actuel visible à l'ouverture.
  useEffect(() => {
    if (target) popRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [target]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
  }, [items, query]);

  if (!target || !pos) return null;
  const title = titleOf(target);
  const pick = (item: Item) => {
    if (item.disabled) return;
    choose(target, item.value);
    close();
  };

  let lastGroup: string | null = null;
  return createPortal(
    <>
      {sheet && <div className="sp-backdrop" aria-hidden="true" />}
      <div
        ref={popRef}
        className={sheet ? 'sp-pop sheet' : 'sp-pop'}
        style={sheet ? undefined : { left: pos.left, top: pos.top, minWidth: pos.width }}
        role="dialog"
        aria-label={title || undefined}
      >
        {sheet && (
          <div className="sp-head">
            <span className="modal-grip" aria-hidden="true" />
            {title && <strong>{title}</strong>}
          </div>
        )}
        {items.length > SEARCH_FROM && (
          <input className="sp-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('ui.select.search')} aria-label={t('ui.select.search')} autoFocus={!sheet} />
        )}
        <ul className="sp-list" role="listbox" aria-label={title || undefined}>
          {shown.map((item, index) => {
            const header = item.group && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const selected = item.value === current;
            return (
              <li key={`${item.value}-${index}`} role="presentation">
                {header && <div className="sp-group">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={item.disabled}
                  className={selected ? 'sp-option selected' : 'sp-option'}
                  onClick={() => pick(item)}
                >
                  <span>{item.label || '—'}</span>
                  {selected && <Check size={16} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="sp-empty">{t('ui.select.no_match')}</li>}
        </ul>
      </div>
    </>,
    document.body,
  );
}
