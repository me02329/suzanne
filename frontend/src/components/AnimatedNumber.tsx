import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 750;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Chiffre clé qui défile jusqu'à sa valeur (à l'affichage, puis d'une valeur à
 * l'autre). Le texte final est exactement celui de `format` ; pendant le
 * défilement, les valeurs intermédiaires sont arrondies au centime. Coupé si
 * le téléphone demande moins d'animations. Les lecteurs d'écran ne lisent que
 * la valeur finale.
 */
export function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(reduce ? value : 0);
  const fromRef = useRef(reduce ? value : 0);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (reduce || !Number.isFinite(value)) { setShown(value); return; }
    const from = shownRef.current;
    fromRef.current = from;
    if (Math.abs(from - value) < 0.005) { setShown(value); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const v = t >= 1 ? value : Math.round((from + (value - from) * easeOut(t)) * 100) / 100;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduce]);

  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}
