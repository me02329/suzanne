import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

// Durée de l'animation de sortie : doit rester alignée sur `modal-out` /
// `backdrop-out` dans global.css (on démonte après ce délai pour laisser le
// fondu se jouer plutôt que de disparaître sèchement).
const CLOSE_MS = 150;

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const [closing, setClosing] = useState(false);

  // Joue le fondu de sortie puis remonte l'info au parent (qui démonte). Idempotent.
  const requestClose = useCallback(() => {
    setClosing((already) => {
      if (!already) window.setTimeout(onClose, CLOSE_MS);
      return true;
    });
  }, [onClose]);

  // Close on Escape — restores conventional modal behaviour.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  return (
    <div className={`modal-backdrop${closing ? ' closing' : ''}`} role="presentation" onMouseDown={requestClose}>
      <div className={`modal${wide ? ' wide' : ''}${closing ? ' closing' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button neutral" type="button" aria-label="Fermer" onClick={requestClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
