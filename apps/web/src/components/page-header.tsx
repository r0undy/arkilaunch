import type { ReactNode } from 'react';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

// One header rhythm shared by every console screen: overline + Condensed
// title (DESIGN.md §2.3 Label/Overline + Display roles) + an action slot.
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1 text-sm font-medium text-text-muted">
            {eyebrow}
          </p>
        )}
        <h1 className="text-display-md text-text lg:text-display-lg">{title}</h1>
        {description && <p className="mt-2 text-base text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
