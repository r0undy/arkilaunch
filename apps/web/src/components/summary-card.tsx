import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Surface } from './surface.js';
import { Button } from './button.js';

export interface SummaryItem {
  label: string;
  value: ReactNode;
}

export interface SummaryCardProps {
  title: string;
  description?: string;
  items: SummaryItem[];
  // The card's one action, usually an Edit button that opens the form in a
  // modal (DESIGN.md §4: create and edit forms open as modals).
  action?: ReactNode;
  children?: ReactNode;
}

// A settings block read at a glance: the saved values, not a wall of inputs.
// Values are operational numbers, so they take the gauge rule (mono,
// tabular-nums); a caller passing prose can wrap it in its own span.
export function SummaryCard({ title, description, items, action, children }: SummaryCardProps) {
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-5" role="group" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text">{title}</h2>
          {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {items.length > 0 && (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-text-muted">{item.label}</dt>
              <dd className="font-mono text-sm tabular-nums text-text">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </Surface>
  );
}

// "Edit" alone is ambiguous when a page has four of them; the accessible
// name says which block it opens.
export function EditButton({ what, onClick }: { what: string; onClick: () => void }) {
  return (
    <Button variant="secondary" onClick={onClick} aria-label={`Edit ${what}`}>
      <Pencil aria-hidden="true" className="h-4 w-4" />
      Edit
    </Button>
  );
}
