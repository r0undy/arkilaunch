import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

// DESIGN.md §4.1 Empty state: name the real thing, offer the next action.
// Never a generic gray blob or a bare "TODO".
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface px-6 py-16 text-center">
      <h2 className="font-display text-lg font-semibold text-text">{title}</h2>
      <p className="max-w-md text-sm text-text-muted">{description}</p>
      {action}
    </div>
  );
}
