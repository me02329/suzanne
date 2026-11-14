import { useId } from 'react';

// Logo de Suzanne (pièces), en une seule couleur : currentColor. Les détails
// (anneaux, séparation, encoches) sont des découpes de masque, lisibles sur
// tout fond. Même dessin que public/icons/icon.svg.
export function SuzanneMark({ size = 24, className }: { size?: number; className?: string }) {
  const id = `suzanne-coins-${useId().replace(/:/g, '')}`;
  return (
    <svg className={className} width={size} height={size} viewBox="362 362 530 530" aria-hidden focusable="false">
      <mask id={id} maskUnits="userSpaceOnUse" x="362" y="362" width="530" height="530">
      <g fill="#fff">
      <ellipse cx="602.5" cy="660" rx="231.5" ry="46" transform="rotate(0 602.5 660)"/>
      <ellipse cx="602.5" cy="806" rx="231.5" ry="46" transform="rotate(0 602.5 806)"/>
      <path d="M834 660 L834 806 L371 806 L371 660 Z"/>
      <ellipse cx="693" cy="476" rx="192" ry="64" transform="rotate(-17 693 476)"/>
      <ellipse cx="693" cy="514" rx="192" ry="64" transform="rotate(-17 693 514)"/>
      <path d="M877.6 426.4 L877.6 464.4 L508.4 563.6 L508.4 525.6 Z"/>
      </g>
      <ellipse cx="602.5" cy="660" rx="205.5" ry="37.7" transform="rotate(0 602.5 660)" fill="none" stroke="#000" strokeWidth="7"/>
      <ellipse cx="693" cy="476" rx="168" ry="51.2" transform="rotate(-17 693 476)" fill="none" stroke="#000" strokeWidth="7"/>
      <path d="M371 748 A231.5 46 0 0 0 834 748" fill="none" stroke="#000" strokeWidth="7"/>
      <rect x="443.8" y="710.4" width="10.5" height="28" rx="1.5" transform="rotate(0 449 724.4)" fill="#000"/>
      <rect x="518.4" y="719.3" width="13.2" height="28" rx="1.5" transform="rotate(0 525 733.3)" fill="#000"/>
      <rect x="594" y="722" width="14" height="28" rx="1.5" transform="rotate(0 601 736)" fill="#000"/>
      <rect x="672.4" y="719.4" width="13.2" height="28" rx="1.5" transform="rotate(0 679 733.4)" fill="#000"/>
      <rect x="749.7" y="710.6" width="10.5" height="28" rx="1.5" transform="rotate(0 755 724.6)" fill="#000"/>
      <rect x="443.8" y="798.4" width="10.5" height="30" rx="1.5" transform="rotate(0 449 813.4)" fill="#000"/>
      <rect x="518.4" y="807.3" width="13.2" height="30" rx="1.5" transform="rotate(0 525 822.3)" fill="#000"/>
      <rect x="594" y="810" width="14" height="30" rx="1.5" transform="rotate(0 601 825)" fill="#000"/>
      <rect x="672.4" y="807.4" width="13.2" height="30" rx="1.5" transform="rotate(0 679 822.4)" fill="#000"/>
      <rect x="749.7" y="798.6" width="10.5" height="30" rx="1.5" transform="rotate(0 755 813.6)" fill="#000"/>
      <rect x="576.2" y="568" width="8" height="21" rx="1.5" transform="rotate(-17 580.2 578.5)" fill="#000"/>
      <rect x="647.9" y="560.7" width="10.4" height="21" rx="1.5" transform="rotate(-17 653.1 571.2)" fill="#000"/>
      <rect x="719.2" y="542.1" width="11" height="21" rx="1.5" transform="rotate(-17 724.7 552.6)" fill="#000"/>
      <rect x="778.4" y="518.7" width="10.1" height="21" rx="1.5" transform="rotate(-17 783.5 529.2)" fill="#000"/>
      <rect x="839.8" y="483.2" width="7.3" height="21" rx="1.5" transform="rotate(-17 843.4 493.7)" fill="#000"/>
      </mask>
      <rect x="362" y="362" width="530" height="530" fill="currentColor" mask={`url(#${id})`}/>
    </svg>
  );
}
