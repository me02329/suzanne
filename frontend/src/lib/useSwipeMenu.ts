import { useEffect } from 'react';

// Geste tactile pour le drawer mobile : swipe depuis le bord gauche pour ouvrir,
// swipe vers la gauche pour fermer. Les écouteurs sont passifs (on ne bloque
// jamais le scroll) et on n'agit qu'au relâchement, une fois le geste confirmé
// comme horizontal et assez ample — un scroll vertical ou un défilement
// horizontal de tableau ne déclenche donc rien.
const MOBILE_QUERY = '(max-width: 1120px)';
// Zone d'ouverture = quart gauche de l'écran (pas l'extrême bord, qui est
// réservé au geste « retour arrière » du système sur mobile).
const OPEN_ZONE_RATIO = 0.25;
const DISTANCE = 55; // px minimum parcourus horizontalement
const MAX_DURATION = 600; // ms : au-delà, c'est un drag lent, pas un swipe

export function useSwipeMenu(open: boolean, setOpen: (value: boolean) => void) {
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      tracking = false;
      if (e.touches.length !== 1) return; // ignore le multi-touch (pinch/zoom)
      if (!window.matchMedia(MOBILE_QUERY).matches) return;
      const touch = e.touches[0]!;
      if (!open) {
        // Menu fermé : on ne capte que les gestes partant du quart gauche de
        // l'écran — sans exiger l'extrême bord, occupé par le « retour arrière »
        // du système.
        if (touch.clientX > window.innerWidth * OPEN_ZONE_RATIO) return;
        // …et jamais au départ d'un tableau scrollable horizontalement, sinon
        // l'ouverture du menu volerait son défilement.
        if (e.target instanceof Element && e.target.closest('.table-wrap')) return;
      }
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      tracking = true;
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      // Geste horizontal franc et assez rapide uniquement.
      if (Date.now() - startTime > MAX_DURATION) return;
      if (Math.abs(dx) < DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (!open && dx > 0) setOpen(true);
      else if (open && dx < 0) setOpen(false);
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [open, setOpen]);
}
