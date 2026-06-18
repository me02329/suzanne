import { useEffect, useRef, type ReactNode } from 'react';

// Repliable animé : le contenu reste monté et s'ouvre / se ferme en fondu +
// hauteur (transition CSS `grid-template-rows` 0fr↔1fr), au lieu d'apparaître
// puis disparaître sèchement via un rendu conditionnel. `inert` quand fermé
// pour que le clavier ne tabule pas dans un formulaire masqué.
export function Collapsible({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  const clipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    if (open) el.removeAttribute('inert');
    else el.setAttribute('inert', '');
  }, [open]);

  return (
    <div className={`collapsible-anim${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="collapsible-anim-clip" ref={clipRef}>
        <div className={className}>{children}</div>
      </div>
    </div>
  );
}
