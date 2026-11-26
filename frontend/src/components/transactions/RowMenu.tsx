import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, HandCoins, Info, Landmark, Link2, MoreHorizontal, Paperclip, Repeat, Split, Trash2 } from 'lucide-react';
import { refundedAmount, type Transaction } from '@suzanne/shared';
import { useDismiss } from '../../lib/useDismiss';

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
  onDetails: (t: Transaction) => void;
  onCopy: (t: Transaction) => void;
  onLink: (t: Transaction) => void;
  onSplit: (t: Transaction) => void;
  onRefund: (t: Transaction) => void;
  onAttachments: (t: Transaction) => void;
  onDelete: (t: Transaction) => void;
  /** Rattacher à un prêt (absent : action non proposée). */
  onLoan?: (t: Transaction) => void;
}

// Actions secondaires d'une ligne (menu « ⋯ »). Seul « pointer » reste
// visible sur la ligne ; le tableau ajoute « Modifier » en tête de ce menu.
export function useTxMenuItems() {
  const { t } = useTranslation();
  return (tx: Transaction, h: TxActionHandlers, opts: { withSplit?: boolean } = {}): RowMenuItem[] => {
    const items: RowMenuItem[] = [
      { key: 'details', label: t('operations.detail.open'), icon: <Info size={16} />, onSelect: () => h.onDetails(tx) },
      { key: 'copy', label: t('operations.copy'), icon: <Copy size={16} />, onSelect: () => h.onCopy(tx) },
      {
        key: 'link',
        label: tx.recurring_transaction_id != null ? t('operations.edit_recurring_link') : t('operations.link_to_recurring_entry'),
        icon: <Repeat size={16} />,
        on: tx.recurring_transaction_id != null,
        onSelect: () => h.onLink(tx),
      },
    ];
    if (tx.type !== 'transfer' && opts.withSplit !== false) {
      const split = (tx.splits ?? []).length > 0;
      items.push({ key: 'split', label: split ? t('operations.edit_split') : t('operations.split_2'), icon: <Split size={16} />, on: split, onSelect: () => h.onSplit(tx) });
    }
    if (tx.type === 'expense') {
      items.push({ key: 'refund', label: t('operations.refund_3'), icon: <HandCoins size={16} />, on: refundedAmount(tx) > 0, onSelect: () => h.onRefund(tx) });
    } else if (tx.type === 'income') {
      const linked = (tx.refund_allocations?.length ?? 0) > 0 || tx.refunds_transaction_id != null;
      items.push({ key: 'refund', label: t('operations.link_to_expenses'), icon: <Link2 size={16} />, on: linked, onSelect: () => h.onRefund(tx) });
    }
    // Mensualité ou remboursement reçu arrivé comme dépense / rentrée simple.
    if (h.onLoan && tx.type !== 'transfer' && (tx.splits ?? []).length === 0 && tx.account_id != null) {
      const onLoan = h.onLoan;
      items.push({ key: 'loan', label: t('patrimoine.loans.link_menu'), icon: <Landmark size={16} />, onSelect: () => onLoan(tx) });
    }
    items.push(
      { key: 'attachments', label: t('operations.attachments'), icon: <Paperclip size={16} />, onSelect: () => h.onAttachments(tx) },
      { key: 'delete', label: t('operations.delete'), icon: <Trash2 size={16} />, danger: true, onSelect: () => h.onDelete(tx) },
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
    const button = buttonRef.current;
    const rect = button?.getBoundingClientRect();
    // Bouton disparu (ligne retirée, vue changée) ou hors de l'écran : on ferme.
    if (!button?.isConnected || !rect || (rect.width === 0 && rect.height === 0)) { setOpen(false); return; }
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

  // Clic / toucher ailleurs, autre menu ouvert, largeur changée : fermeture
  // commune. Le défilement repositionne (voir place) au lieu de fermer.
  useDismiss(open, () => setOpen(false), [buttonRef, menuRef], { closeOnScroll: false, escape: false });
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="icon-ghost jr-menu-trigger"
        aria-label={label ?? t('operations.more_actions_2')}
        title={label ?? t('operations.more_actions_2')}
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
