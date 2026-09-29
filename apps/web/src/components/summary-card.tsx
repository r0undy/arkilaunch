import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Container } from './container.js';
import { Button } from './button.js';

export interface SummaryItem {
  label: string;
  value: ReactNode;
}

export interface SummaryCardProps {
  title: string;
  description?: string;
  items: SummaryItem[];
  action?: ReactNode;
  children?: ReactNode;
}

export function SummaryCard({ title, description, items, action, children }: SummaryCardProps) {
  return (
    <Container role="group" aria-label={title} header={{ title, description, actions: action }}>
      {items.length > 0 && (
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <dt className="text-sm font-medium text-text-muted">{item.label}</dt>
              <dd className="font-mono text-sm tabular-nums text-text">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </Container>
  );
}

export function EditButton({ what, onClick }: { what: string; onClick: () => void }) {
  return (
    <Button variant="secondary" onClick={onClick} aria-label={`Edit ${what}`}>
      <Pencil aria-hidden="true" className="h-4 w-4" />
      Edit
    </Button>
  );
}
