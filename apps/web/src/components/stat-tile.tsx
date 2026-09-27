import type { ReactNode } from 'react';
import { Surface } from './surface.js';

// One KPI on the dashboard: overline label, the number in Plex Mono (the
// gauge rule, DESIGN.md §2.3), and a line saying what it means or where to
// act on it. `value` null is loading -- a dash, never a fake zero.

export interface StatTileProps {
  label: string;
  value: ReactNode | null;
  hint?: string;
  // Where to act on it: a Link, usually.
  action?: ReactNode;
}

export function StatTile({ label, value, hint, action }: StatTileProps) {
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-1 p-4">
      <p className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">{label}</p>
      <p className="font-mono text-3xl font-medium tabular-nums text-text">{value ?? '--'}</p>
      {hint && <p className="text-sm text-text-muted">{hint}</p>}
      {action && <div className="mt-auto pt-1 text-sm font-semibold text-accent">{action}</div>}
    </Surface>
  );
}
