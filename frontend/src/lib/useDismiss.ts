import { useEffect, useId, useRef, type RefObject } from 'react';

// Comportement commun des menus et listes déroulantes flottants : un seul ouvert
// à la fois, et fermeture dès qu'on clique / touche ailleurs, appuie sur Échap,
// fait défiler la page ou redimensionne la fenêtre. Sans ça, un menu positionné
// en `fixed` peut rester affiché alors que le bouton qui l'a ouvert a défilé
// hors de vue ou n'existe plus.
const OPEN_EVENT = 'suzanne:menu-open';

export function useDismiss(
  open: boolean,
  close: () => void,
  // Éléments « dedans » : le bouton déclencheur et le menu (souvent en portail).
  refs: Array<RefObject<HTMLElement | null>>,
  options: { closeOnScroll?: boolean; escape?: boolean } = {},
): void {
  const id = useId();
  const closeRef = useRef(close);
  closeRef.current = close;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const { closeOnScroll = true, escape = true } = options;

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && refsRef.current.some((r) => r.current?.contains(target));
    const dismiss = () => closeRef.current();

    // Un autre menu s'ouvre : celui-ci se ferme.
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    const onOtherOpen = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) dismiss(); };
    // pointerdown couvre souris, doigt et stylet (mousedown n'arrive pas
    // toujours au toucher, par ex. quand le doigt fait défiler).
    const onPointerDown = (event: PointerEvent) => { if (!inside(event.target)) dismiss(); };
    const onKey = (event: KeyboardEvent) => { if (escape && event.key === 'Escape') dismiss(); };
    // Défilement ailleurs que dans le menu lui-même (une longue liste interne
    // doit pouvoir défiler).
    const onScroll = (event: Event) => { if (!inside(event.target)) dismiss(); };
    // Largeur seulement : sur mobile, le clavier virtuel change la hauteur (et
    // fermerait un menu qui contient un champ de recherche).
    const width = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== width) dismiss(); };

    window.addEventListener(OPEN_EVENT, onOtherOpen);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    if (closeOnScroll) window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOtherOpen);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      if (closeOnScroll) window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, id, escape, closeOnScroll]);
}
