import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Category } from '@suzanne/shared';
import { useHintDelay } from '../lib/prefs';

// Infobulle qui n'apparaît qu'après un survol prolongé (délai réglable dans
// Réglages › Préférences). Rendue dans <body> : jamais coupée par un tableau
// ou une liste qui défile.
export function HoverHint({ hint, children, className }: { hint: ReactNode | null | undefined; children: ReactNode; className?: string }) {
  const delay = useHintDelay();
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setPos(null);
  };
  useEffect(() => clear, []);
  if (!hint || delay < 0) return <span className={className}>{children}</span>;

  const start = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const above = rect.bottom + 120 > window.innerHeight;
      setPos({ x: Math.min(Math.max(12, rect.left), window.innerWidth - 292), y: above ? rect.top - 8 : rect.bottom + 8, above });
    }, delay);
  };

  return (
    <span ref={ref} className={className} onMouseEnter={start} onMouseLeave={clear} onMouseDown={clear} onFocus={start} onBlur={clear}>
      {children}
      {pos && createPortal(
        <div role="tooltip" className={`hover-hint${pos.above ? ' above' : ''}`} style={{ left: pos.x, top: pos.y }}>{hint}</div>,
        document.body,
      )}
    </span>
  );
}

// Nom de catégorie avec sa description au survol.
export function CategoryName({ category, fallback = '—', className }: { category: Category | null | undefined; fallback?: string; className?: string }) {
  if (!category) return <span className={className}>{fallback}</span>;
  return (
    <HoverHint hint={category.description ? <><strong>{category.name}</strong><span>{category.description}</span></> : null} className={className}>
      {category.name}
    </HoverHint>
  );
}

// Enveloppe un <select> de catégorie : la description de la catégorie choisie
// s'affiche au survol.
export function CategoryHint({ category, children }: { category: Category | null | undefined; children: ReactNode }) {
  return (
    <HoverHint hint={category?.description ? <><strong>{category.name}</strong><span>{category.description}</span></> : null} className="hint-wrap">
      {children}
    </HoverHint>
  );
}
