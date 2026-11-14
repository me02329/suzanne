import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ToastKind = 'success' | 'error';

// Notification flottante, fermée automatiquement : vite pour un succès, plus
// tard pour une erreur ou quand une action (« Annuler ») est proposée.
// Le minuteur ne dépend que du message : les callbacks passent par une ref,
// sinon chaque re-rendu du parent (ex. streaming de l'assistant) le relançait
// et le toast ne disparaissait jamais.
export function Toast({ kind, message, action, onDismiss }: {
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const hasAction = Boolean(action);
  useEffect(() => {
    const delay = kind === 'error' || hasAction ? 6000 : 2500;
    const handle = window.setTimeout(() => dismissRef.current(), delay);
    return () => window.clearTimeout(handle);
  }, [kind, message, hasAction]);

  return (
    <div className={`toast toast-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {action && (
        <button type="button" className="toast-action" onClick={() => { onDismiss(); action.onClick(); }}>
          {action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label={t('ui.toast.close')} onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
