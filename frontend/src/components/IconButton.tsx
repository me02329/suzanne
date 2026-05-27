import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';

export type IconButtonTone = 'danger' | 'neutral' | 'accent';

export function IconButton({
  label,
  onClick,
  icon,
  confirm,
  tone = 'danger',
}: {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  confirm?: string;
  tone?: IconButtonTone;
}) {
  const handle = () => { if (!confirm || window.confirm(confirm)) onClick(); };
  const toneClass = tone === 'neutral' ? 'icon-button neutral' : tone === 'accent' ? 'icon-button accent' : 'icon-button';
  return (
    <button type="button" className={toneClass} aria-label={label} title={label} onClick={handle}>
      {icon ?? <Trash2 size={16} />}
    </button>
  );
}
