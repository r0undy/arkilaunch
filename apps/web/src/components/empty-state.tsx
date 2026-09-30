import type { ReactNode } from 'react';
import { Container } from './container.js';

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  /** Inside an existing container or table: just the centred body, no shell of its own. */
  bare?: boolean;
}

// Cloudscape empty state: a bold line, one muted line, an optional button. No icon, no special card:
// standalone it sits in the same container shell as a table with no rows.
export function EmptyState({ title, description, action, bare = false }: EmptyStateProps) {
  const body = (
    <div className="flex flex-col items-center gap-1 px-6 py-8 text-center">
      <p className="text-sm font-bold text-text">{title}</p>
      <p className="max-w-md text-sm text-text-muted">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
  return bare ? body : <Container flush>{body}</Container>;
}
