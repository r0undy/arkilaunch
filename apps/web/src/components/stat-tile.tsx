import type { ReactNode } from 'react';
import { Surface } from './surface.js';

// One KPI on the dashboard: overline label, the number in Plex Mono (the
// gauge rule, DESIGN.md §2.3), and a line saying what it means or where to
// act on it; the whole tile is the action's hit area. `value` null is loading -- a dash, never a fake zero.

export interface StatTileProps {
  label: string;
  value: ReactNode | null;
  hint?: string;
  // Where to act on it: a Link, usually.
  action?: ReactNode;
}

export function StatTile({ label, value, hint, action }: StatTileProps) {
  return (
    <Surface radius="md" elevation="sm" className={['relative flex min-w-0 flex-col gap-1 p-4', action ? 'transition-shadow hover:shadow-md focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring' : ''].join(' ')}>
      <p className="text-sm font-medium text-text-muted">{label}</p>
      <p className="font-mono text-2xl font-medium tabular-nums text-text [overflow-wrap:anywhere] xl:text-3xl">{value ?? '--'}</p>
      {hint && <p className="text-sm text-text-muted">{hint}</p>}
      {action && <div className="mt-auto pt-1 text-sm font-semibold text-accent [&_a]:after:absolute [&_a]:after:inset-0 [&_a]:after:content-[''] [&_a]:focus-visible:outline-none">{action}</div>}
    </Surface>
  );
}
