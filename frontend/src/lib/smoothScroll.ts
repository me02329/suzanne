import { useEffect } from 'react';
import Lenis from 'lenis';

// Défilement « inertiel » à la molette (Lenis), réglage doux. Le tactile reste
// natif (pas de `syncTouch`) et l'effet est désactivé si l'utilisateur demande
// moins d'animations. Les conteneurs à défilement interne sont exemptés via
// `data-lenis-prevent` pour ne pas faire défiler la page derrière eux.
const PREVENT_SELECTOR = [
  '.sidebar',
  '.modal',
  '.refund-candidates',
  '.refund-selected-list',
  '.drilldown-list',
  '.table-scroll',
  '.category-list.compact',
  '.assistant-chat',
].join(', ');

function tagScrollables(node: ParentNode): void {
  node.querySelectorAll<HTMLElement>(PREVENT_SELECTOR).forEach((el) => el.setAttribute('data-lenis-prevent', ''));
}

export function useSmoothScroll(): void {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({ smoothWheel: true, lerp: 0.1, wheelMultiplier: 1 });

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    // Exempte les scrollers existants, puis ceux montés plus tard (modales,
    // popovers de drill-down…) au fil des mutations du DOM.
    tagScrollables(document);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((added) => {
          if (!(added instanceof HTMLElement)) return;
          if (added.matches(PREVENT_SELECTOR)) added.setAttribute('data-lenis-prevent', '');
          tagScrollables(added);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      lenis.destroy();
    };
  }, []);
}
