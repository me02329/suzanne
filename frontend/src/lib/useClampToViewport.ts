import { useLayoutEffect, type RefObject } from 'react';

const MARGIN = 8;

/**
 * Garde un élément flottant (menu, liste déroulante) entièrement dans l'écran :
 * après chaque placement, mesure sa boîte et le décale (translate) de ce qui
 * dépasse à gauche, à droite, en haut ou en bas, avec une marge de 8 px. Sur
 * téléphone, un menu aligné sur un bouton placé à gauche sortait de l'écran.
 * La zone utile est celle du viewport visuel (clavier ouvert compris).
 */
export function useClampToViewport(ref: RefObject<HTMLElement | null>, active: boolean, deps: unknown[] = []) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    el.style.translate = '';
    const vv = window.visualViewport;
    const width = vv?.width ?? window.innerWidth;
    const height = vv?.height ?? window.innerHeight;
    const offsetTop = vv?.offsetTop ?? 0;
    const offsetLeft = vv?.offsetLeft ?? 0;
    const r = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.width + 2 * MARGIN <= width) {
      if (r.left < offsetLeft + MARGIN) dx = offsetLeft + MARGIN - r.left;
      else if (r.right > offsetLeft + width - MARGIN) dx = offsetLeft + width - MARGIN - r.right;
    } else {
      dx = offsetLeft + MARGIN - r.left; // plus large que l'écran : calé à gauche
    }
    if (r.height + 2 * MARGIN <= height) {
      if (r.top < offsetTop + MARGIN) dy = offsetTop + MARGIN - r.top;
      else if (r.bottom > offsetTop + height - MARGIN) dy = offsetTop + height - MARGIN - r.bottom;
    }
    if (dx !== 0 || dy !== 0) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);
}
