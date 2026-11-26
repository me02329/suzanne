import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useDismiss } from '../../lib/useDismiss';
import { useClampToViewport } from '../../lib/useClampToViewport';
import { confirmDialog } from '../Dialogs';

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  // Action destructive : texte en rouge, séparée des autres.
  danger?: boolean;
  // Confirmation native — seulement si l'action ne peut pas être annulée.
  confirm?: string;
  disabled?: boolean;
}

// Menu « ⋯ » des actions de ligne secondaires (au plus 2 actions visibles par
// ligne, le reste ici — voir docs/DESIGN.md). Positionné en `fixed` pour ne
// pas être rogné par un conteneur à défilement (tableaux).
export function RowMenu({ items, label = 'Plus d’actions' }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClampToViewport(menuRef, open && pos !== null, [pos]);
  const menuId = useId();

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const up = window.innerHeight - rect.bottom < 56 * items.length + 24 && rect.top > window.innerHeight / 2;
    setPos({ top: up ? rect.top - 6 : rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right), up });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  // Clic / toucher ailleurs, défilement, autre menu ouvert : fermeture commune.
  useDismiss(open, () => setOpen(false), [buttonRef, menuRef], { escape: false });
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        buttonRef.current?.focus();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  const select = (item: RowMenuItem) => {
    setOpen(false);
    if (!item.confirm) { item.onSelect(); return; }
    void confirmDialog(item.confirm, { danger: item.danger }).then((ok) => { if (ok) item.onSelect(); });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={open ? 'icon-button neutral row-menu-trigger open' : 'icon-button neutral row-menu-trigger'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className={pos.up ? 'row-menu up' : 'row-menu'}
          style={pos.up ? { bottom: window.innerHeight - pos.top, right: pos.right } : { top: pos.top, right: pos.right }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'row-menu-item danger' : 'row-menu-item'}
              disabled={item.disabled}
              onClick={() => select(item)}
            >
              {item.icon && <span className="row-menu-icon" aria-hidden="true">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        // Au niveau du document : aucun parent animé ou déplacé (fenêtre,
        // glissement de page) ne décale le menu.
        document.body,
      )}
    </>
  );
}
