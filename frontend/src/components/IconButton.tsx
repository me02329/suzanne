import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';

export type IconButtonTone = 'danger' | 'neutral' | 'accent';

// Bouton-icône carré (34px, 44px au tactile). `confirm` demande une
// confirmation native avant d'agir — à réserver aux actions irréversibles
// (sinon : toast « Annuler », voir docs/DESIGN.md).
export function IconButton({
  label,
  onClick,
  icon,
  confirm,
  tone = 'danger',
  disabled = false,
  className,
}: {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  confirm?: string;
  tone?: IconButtonTone;
  disabled?: boolean;
  className?: string;
}) {
  const handle = () => { if (!confirm || window.confirm(confirm)) onClick(); };
  const toneClass = tone === 'neutral' ? 'icon-button neutral' : tone === 'accent' ? 'icon-button accent' : 'icon-button';
  return (
    <button type="button" className={className ? `${toneClass} ${className}` : toneClass} aria-label={label} title={label} onClick={handle} disabled={disabled}>
      {icon ?? <Trash2 size={16} />}
    </button>
  );
}
