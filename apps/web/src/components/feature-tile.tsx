import type { ReactNode } from 'react';

export interface FeatureTileProps {
  icon: ReactNode;
  title: string;
  description: string;
}

// DSD §4 FeatureTile: white surface-mk card, radius-mk-lg, 48px icon, hover
// lift 300ms cubic-bezier(0.34, 1.56, 0.64, 1) (marketing hover-lift, §5).
export function FeatureTile({ icon, title, description }: FeatureTileProps) {
  return (
    <div className="flex flex-col gap-3 rounded-mk-lg bg-surface-mk p-6 shadow-mk-card transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-1">
      <div className="flex h-12 w-12 items-center justify-center rounded-mk-sm bg-bg-mk text-ink-mk">{icon}</div>
      <h3 className="font-display text-base font-semibold text-ink-mk">{title}</h3>
      <p className="text-sm text-text-muted">{description}</p>
    </div>
  );
}
