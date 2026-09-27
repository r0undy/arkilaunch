import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  // DESIGN.md §4.1: an icon that names the thing, drawn in the accent tone.
  icon?: LucideIcon | undefined;
}

// DESIGN.md §4.1 Empty state: name the real thing, offer the next action.
// Never a generic gray blob or a bare "TODO".
export function EmptyState({ title, description, action, icon: Icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface px-6 py-16 text-center">
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-surface-sunk text-accent" aria-hidden="true">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <h2 className="font-display text-lg font-semibold text-text">{title}</h2>
      <p className="max-w-md text-sm text-text-muted">{description}</p>
      {action}
    </div>
  );
}
