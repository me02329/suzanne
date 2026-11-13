import type { ReactNode } from 'react';

// `sticky` makes the panel follow the scroll on >1023px viewports (the
// breakpoint at which .split keeps two columns). On narrower screens the
// CSS disables sticky so the layout stays mobile-friendly.
export function Panel({ title, children, action, sticky = false, icon, className }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  sticky?: boolean;
  // Optional leading icon rendered before the title; gives a page its visual
  // identity. Colored with the accent via .panel-icon.
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={['panel', sticky ? 'panel-sticky' : '', className ?? ''].filter(Boolean).join(' ')}>
      <div className="panel-header">
        <h2 className="panel-title">
          {icon && <span className="panel-icon" aria-hidden="true">{icon}</span>}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}
