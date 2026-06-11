import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Panel } from './Panel';

// Résumé compact d'une donnée dont la page de référence est ailleurs : le
// panel n'affiche qu'un extrait et le lien « Voir » emmène vers la page où
// l'on consulte/édite la donnée complète. C'est le pendant UI de la règle
// « une info = une page de référence ».
export function SummaryCard({ title, icon, to, linkLabel = 'Voir', children }: {
  title: string;
  icon?: ReactNode;
  to: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <Panel
      title={title}
      icon={icon}
      action={(
        <Link className="panel-link" to={to}>
          {linkLabel} <ArrowRight size={14} />
        </Link>
      )}
    >
      {children}
    </Panel>
  );
}
