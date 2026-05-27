import type { ReactNode } from 'react';

// `sticky` makes the panel follow the scroll on >860px viewports (the
// breakpoint at which .split keeps two columns). On narrower screens the
// CSS disables sticky so the layout stays mobile-friendly.
export function Panel({ title, children, action, sticky = false }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  sticky?: boolean;
}) {
  return (
    <div className={sticky ? 'panel panel-sticky' : 'panel'}>
      <div className="panel-header">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
