import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, HandCoins, Link2, MoreHorizontal, Paperclip, Repeat, Split, Trash2 } from 'lucide-react';
import { refundedAmount, type Transaction } from '@suzanne/shared';

export interface RowMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Indique un état « actif » (déjà ventilée, déjà liée…). */
  on?: boolean;
}

export interface TxActionHandlers {
  onCopy: (t: Transaction) => void;
  onLink: (t: Transaction) => void;
  onSplit: (t: Transaction) => void;
  onRefund: (t: Transaction) => void;
  onAttachments: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
}

// Actions secondaires d'une ligne (menu « ⋯ »). Pointer et modifier restent
// visibles sur la ligne ; tout le reste vit ici.
export function useTxMenuItems() {
  const { t } = useTranslation();
  return (tx: Transaction, h: TxActionHandlers, opts: { withSplit?: boolean } = {}): RowMenuItem[] => {
    const items: RowMenuItem[] = [
      { key: 'copy', label: t('Copier'), icon: <Copy size={16} />, onSelect: () => h.onCopy(tx) },
      {
        key: 'link',
        label: tx.recurring_transaction_id != null ? t('Modifier le lien de récurrence') : t('Lier à une récurrence'),
        icon: <Repeat size={16} />,
        on: tx.recurring_transaction_id != null,
        onSelect: () => h.onLink(tx),
      },
    ];
    if (tx.type !== 'transfer' && opts.withSplit !== false) {
      const split = (tx.splits ?? []).length > 0;
      items.push({ key: 'split', label: split ? t('Modifier la ventilation') : t('Ventiler'), icon: <Split size={16} />, on: split, onSelect: () => h.onSplit(tx) });
    }
    if (tx.type === 'expense') {
      items.push({ key: 'refund', label: t('Créer le remboursement'), icon: <HandCoins size={16} />, on: refundedAmount(tx) > 0, onSelect: () => h.onRefund(tx) });
    } else if (tx.type === 'income') {
      const linked = (tx.refund_allocations?.length ?? 0) > 0 || tx.refunds_transaction_id != null;
      items.push({ key: 'refund', label: t('Lier à une dépense'), icon: <Link2 size={16} />, on: linked, onSelect: () => h.onRefund(tx) });
    }
    items.push(
      { key: 'attachments', label: t('Pièces jointes'), icon: <Paperclip size={16} />, onSelect: () => h.onAttachments(tx) },
      { key: 'delete', label: t('Supprimer'), icon: <Trash2 size={16} />, danger: true, onSelect: () => h.onDelete(tx) },
    );
    return items;
  };
}

// Menu déroulant positionné en `fixed` (les tableaux défilent horizontalement
// et rogneraient un menu absolu).
export function RowMenu({ items, label }: { items: RowMenuItem[]; label?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position calculée depuis le bouton ; suit le défilement (un menu qui se
  // fermerait au moindre scroll serait inutilisable au doigt).
  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return; }
    const up = rect.bottom + 300 > window.innerHeight && rect.top > 300;
    setPos({ top: up ? rect.top - 4 : rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right), up });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  const placed = pos !== null;
  useEffect(() => {
    if (open && placed) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="icon-ghost jr-menu-trigger"
        aria-label={label ?? t('Plus d\'actions')}
        title={label ?? t('Plus d\'actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen((v) => !v); }}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          className={`jr-menu${pos.up ? ' up' : ''}`}
          role="menu"
          style={{ top: pos.top, right: pos.right }}
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`jr-menu-item${item.danger ? ' danger' : ''}${item.on ? ' on' : ''}`}
              onClick={() => { setOpen(false); item.onSelect(); }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
