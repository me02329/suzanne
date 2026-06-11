import { useEffect } from 'react';
import { X } from 'lucide-react';

export type ToastKind = 'success' | 'error';

// Floating, dismissible notification rendered above page content (bottom-right
// on desktop, bottom strip on mobile). Auto-dismisses after a delay; success
// disappears quickly, error stays a bit longer so the user has time to read it.
// `action` (ex. « Annuler » après une suppression) rallonge le délai pour
// laisser le temps de cliquer.
export function Toast({ kind, message, action, onDismiss }: {
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const delay = kind === 'error' || action ? 6000 : 2500;
    const handle = window.setTimeout(onDismiss, delay);
    return () => window.clearTimeout(handle);
  }, [kind, message, action, onDismiss]);

  return (
    <div className={`toast toast-${kind}`} role="status" aria-live="polite">
      <span>{message}</span>
      {action && (
        <button type="button" className="toast-action" onClick={() => { onDismiss(); action.onClick(); }}>
          {action.label}
        </button>
      )}
      <button type="button" aria-label="Fermer" onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
