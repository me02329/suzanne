import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import '../styles/components/touch-gestures.css';

// Gestes tactiles de la coquille (écrans tactiles seulement) :
// - glisser vers le bas en haut de page → actualiser les données ;
// - glisser à gauche / à droite, dans les 70 % du haut de l'écran → sous-page
//   suivante / précédente de la section (Journal → À vérifier…) ;
// - même geste dans les 30 % du bas (barre du bas comprise) → grande page
//   suivante / précédente (Accueil → Opérations → Comptes…).
// Le glissé horizontal est permissif (un geste à peu près horizontal suffit)
// mais ignore les bords de l'écran, réservés au geste « retour » d'iOS et
// d'Android, ainsi que tout ce qui défile déjà horizontalement (tableaux,
// barre d'onglets), les champs de saisie, les graphiques et les fenêtres.
// Animations faites directement sur le DOM : pas de rendu React à chaque pixel.

const EDGE = 28; // px réservés au geste système de chaque côté
const AXIS_LOCK = 10; // px avant de décider horizontal / vertical
const SWIPE_MIN = 56; // px pour changer d'onglet
const SWIPE_FAST = 0.35; // px/ms : un geste vif suffit avec moins de distance
const PULL_TRIGGER = 72; // px (après résistance) pour actualiser
const PULL_MAX = 110;

// Zones où un glissé ne change jamais de page : champs, fenêtres, menus,
// graphiques, et toute barre d'onglets ou de sous-pages (barre de la section,
// onglets internes, sélecteurs segmentés, pastilles) — qu'elle déborde ou non.
const IGNORE = [
  'input', 'textarea', 'select', '[contenteditable="true"]',
  '[role="dialog"]', '.modal', '[role="menu"]', '[role="listbox"]', '.cat-select-pop',
  '.recharts-wrapper', '.no-swipe',
  'nav', '.subnav', '[role="tablist"]', '[role="radiogroup"]',
  '.acc-seg', '.jr-seg', '.st-segment', '.st-toggle', '.pi-tabs', '.series-toggles',
  '.tag-picker-chips', '.bg-hero-chips', '.icon-picker-groups',
].join(', ');
const SECTIONS_ZONE = 0.7; // au-delà de 70 % de la hauteur : grandes pages
export type SwipeZone = 'tabs' | 'sections';
const OVERLAYS = '.sheet-backdrop, .modal-backdrop, .drilldown-backdrop, [aria-modal="true"], [role="dialog"]';

/** Un ancêtre défile-t-il horizontalement (tableau large, barre d'onglets…) ? */
function inHorizontalScroller(el: Element | null): boolean {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 2) return true;
  }
  return false;
}

export function TouchGestures({ onSwipe, onRefresh, canSwipe }: {
  /** 'next' = glissé vers la gauche, 'prev' = vers la droite. */
  onSwipe: (direction: 'next' | 'prev', zone: SwipeZone) => void;
  onRefresh: () => Promise<unknown>;
  /** Y a-t-il une page dans cette direction ? (sinon simple rebond) */
  canSwipe: (direction: 'next' | 'prev', zone: SwipeZone) => boolean;
}) {
  const indicator = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onSwipe, onRefresh, canSwipe });
  handlers.current = { onSwipe, onRefresh, canSwipe };

  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    document.documentElement.classList.add('touch-gestures');

    let start: { x: number; y: number; t: number } | null = null;
    let axis: 'x' | 'y' | null = null;
    let swipeAllowed = false;
    let zone: SwipeZone = 'tabs';
    let pullAllowed = false;
    let pull = 0;
    let refreshing = false;
    const content = () => document.querySelector<HTMLElement>('.shell .content');

    const setPull = (value: number, settle = false) => {
      const el = indicator.current;
      if (!el) return;
      el.classList.toggle('settle', settle);
      el.style.setProperty('--pull', `${value}px`);
      el.classList.toggle('armed', value >= PULL_TRIGGER);
      el.style.opacity = value > 4 || refreshing ? '1' : '0';
    };
    const setShift = (dx: number, settle = false) => {
      const el = content();
      if (!el) return;
      el.style.transition = settle ? 'transform 180ms ease-out, opacity 180ms ease-out' : 'none';
      el.style.transform = dx ? `translateX(${dx}px)` : '';
      el.style.opacity = dx ? String(1 - Math.min(Math.abs(dx) / 600, 0.25)) : '';
    };

    const onStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1 || refreshing) return;
      const touch = event.touches[0]!;
      const target = event.target instanceof Element ? event.target : null;
      // La barre du bas est une zone « grandes pages » à part entière (elle est
      // un <nav>, exclu sinon comme les autres barres).
      const onTabbar = target?.closest('.tabbar') != null;
      if (!onTabbar && target?.closest(IGNORE)) return;
      // Panneau « Plus », fenêtre ou feuille ouverte (fond grisé compris) :
      // aucun geste sur la page en dessous.
      if (document.querySelector(OVERLAYS)) return;
      start = { x: touch.clientX, y: touch.clientY, t: event.timeStamp };
      axis = null;
      zone = onTabbar || touch.clientY > window.innerHeight * SECTIONS_ZONE ? 'sections' : 'tabs';
      swipeAllowed = touch.clientX > EDGE && touch.clientX < window.innerWidth - EDGE && !inHorizontalScroller(target);
      pullAllowed = !onTabbar && window.scrollY <= 0;
      pull = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!axis) {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
        // Permissif : horizontal dès que |dx| dépasse ~0,85 |dy| (≈ 50°).
        axis = Math.abs(dx) > Math.abs(dy) * 0.85 ? 'x' : 'y';
      }
      if (axis === 'x' && swipeAllowed) {
        const allowed = handlers.current.canSwipe(dx < 0 ? 'next' : 'prev', zone);
        setShift(allowed ? dx * 0.35 : dx * 0.08);
      } else if (axis === 'y' && pullAllowed && dy > 0 && window.scrollY <= 0) {
        pull = Math.min(PULL_MAX, dy * 0.5);
        setPull(pull);
      }
    };

    const onEnd = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      const dx = touch ? touch.clientX - start.x : 0;
      const dy = touch ? touch.clientY - start.y : 0;
      const speed = Math.abs(dx) / Math.max(1, event.timeStamp - start.t);
      const wasAxis = axis;
      start = null;

      if (wasAxis === 'x' && swipeAllowed) {
        setShift(0, true);
        const direction = dx < 0 ? 'next' : 'prev';
        const far = Math.abs(dx) >= SWIPE_MIN || (Math.abs(dx) >= 32 && speed >= SWIPE_FAST);
        if (far && Math.abs(dy) < 140 && !window.getSelection()?.toString() && handlers.current.canSwipe(direction, zone)) {
          handlers.current.onSwipe(direction, zone);
        }
      }
      if (wasAxis === 'y' && pull > 0) {
        if (pull >= PULL_TRIGGER) {
          refreshing = true;
          indicator.current?.classList.add('refreshing');
          setPull(PULL_TRIGGER * 0.75, true);
          void handlers.current.onRefresh().finally(() => {
            refreshing = false;
            indicator.current?.classList.remove('refreshing');
            setPull(0, true);
          });
        } else {
          setPull(0, true);
        }
      }
      pull = 0;
    };

    const onCancel = () => { start = null; setShift(0, true); if (!refreshing) setPull(0, true); };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.documentElement.classList.remove('touch-gestures');
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, []);

  return (
    <div ref={indicator} className="pull-indicator" aria-hidden>
      <RefreshCw size={20} />
    </div>
  );
}
