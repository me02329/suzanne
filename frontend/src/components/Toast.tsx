import { useEffect } from 'react';
import { X } from 'lucide-react';

export type ToastKind = 'success' | 'error';

// Floating, dismissible notification rendered above page content (bottom-right
// on desktop, bottom strip on mobile). Auto-dismisses after a delay; success
// disappears quickly, error stays a bit longer so the user has time to read it.
export function Toast({ kind, message, onDismiss }: { kind: ToastKind; message: string; onDismiss: () => void }) {
  useEffect(() => {
    const delay = kind === 'success' ? 2500 : 6000;
    const handle = window.setTimeout(onDismiss, delay);
    return () => window.clearTimeout(handle);
  }, [kind, message, onDismiss]);

  return (
    <div className={`toast toast-${kind}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" aria-label="Fermer" onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
