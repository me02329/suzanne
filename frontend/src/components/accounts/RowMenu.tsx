import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { useDismiss } from '../../lib/useDismiss';
import { useClampToViewport } from '../../lib/useClampToViewport';
import '../../styles/pages/accounts.css';

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

// Menu « ⋯ » d'une ligne : les actions secondaires (archiver, supprimer…).
// Rendu dans <body> en position fixe : jamais rogné par une liste ou un
// tableau qui défile ; s'ouvre vers le haut s'il manque de place en bas.
// Se ferme au clic extérieur, à Échap, au défilement et après une action.
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClampToViewport(menuRef, open && pos != null, [pos]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const needed = 44 * items.length + 20;
    const up = window.innerHeight - rect.bottom < needed && rect.top > needed;
    setPos({ top: up ? rect.top - 4 : rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right), up });
  }, [open, items.length]);

  useDismiss(open, () => setOpen(false), [buttonRef, menuRef]);

  return (
    <div className="rmenu">
      <button
        ref={buttonRef}
        type="button"
        className="row-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="rmenu-pop floating"
          role="menu"
          style={pos.up ? { bottom: window.innerHeight - pos.top, right: pos.right } : { top: pos.top, right: pos.right }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : undefined}
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick(); }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
