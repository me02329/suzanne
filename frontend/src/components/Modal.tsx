import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Durée de l'animation de sortie : doit rester alignée sur `modal-out` /
// `backdrop-out` (on démonte après ce délai pour laisser le fondu se jouer).
const CLOSE_MS = 150;

// Pile des modales ouvertes : Échap ne ferme que celle du dessus, et le
// défilement de la page n'est rendu qu'à la fermeture de la dernière.
const stack: string[] = [];
let savedOverflow = '';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');
const FIELDS = 'input:not([disabled]):not([type="hidden"]):not([type="file"]), select:not([disabled]), textarea:not([disabled])';

function visible(el: HTMLElement) {
  return !el.hasAttribute('hidden') && el.getClientRects().length > 0;
}

// Modale accessible : focus sur le premier champ, piège à focus, retour du
// focus à l'élément d'origine, Échap (modale du dessus seulement), page figée.
// ≤ 640px elle s'affiche en feuille depuis le bas (voir theme.css).
// `footer` (optionnel) : barre d'actions collée en bas de la modale.
export function Modal({ title, children, onClose, wide = false, footer }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Joue le fondu de sortie puis remonte l'info au parent (qui démonte). Idempotent.
  const requestClose = useCallback(() => {
    setClosing((already) => {
      if (!already) window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
      return true;
    });
  }, []);

  // Pile, verrouillage du scroll, focus initial et restauration.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    stack.push(id);
    if (stack.length === 1) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const field = Array.from(dialog.querySelectorAll<HTMLElement>(FIELDS)).find(visible);
      const fallback = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).find((el) => visible(el) && !el.classList.contains('modal-close'));
      (field ?? fallback ?? dialog).focus({ preventScroll: true });
    }
    return () => {
      const index = stack.lastIndexOf(id);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) document.body.style.overflow = savedOverflow;
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [id]);

  // Échap (modale du dessus uniquement) + piège à focus sur Tab.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
      if (items.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, requestClose]);

  // Au niveau du document (portail) : une fenêtre ouverte depuis un élément
  // animé ou déplacé (autre fenêtre, glissement de page, ligne de tableau)
  // resterait sinon calée sur lui au lieu de l'écran.
  return createPortal(
    <div className={`modal-backdrop${closing ? ' closing' : ''}`} role="presentation" onMouseDown={requestClose}>
      <div
        ref={dialogRef}
        className={`modal${wide ? ' wide' : ''}${footer ? ' has-footer' : ''}${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-grip" aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
          <button className="icon-ghost modal-close" type="button" aria-label={t('ui.modal.close')} onClick={requestClose}>
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="modal-actions modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
