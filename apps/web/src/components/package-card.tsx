import type { ReactNode } from 'react';

export interface PackageCardProps {
  name: string;
  price: string;
  features: string[];
  featured?: boolean;
  action?: ReactNode;
}

// DSD §4 PackageCard: featured variant scale-104 z-10 on --color-ink-mk with
// inverse text; outer variants on --color-surface-mk with a +/-1deg rotation.
export function PackageCard({ name, price, features, featured = false, action }: PackageCardProps) {
  return (
    <div
      className={[
        'flex flex-col gap-4 rounded-mk-lg p-8',
        featured
          ? 'z-10 scale-[1.04] bg-ink-mk text-text-inverse shadow-mk-card'
          : 'rotate-1 bg-surface-mk text-text shadow-mk-card first:-rotate-1',
      ].join(' ')}
    >
      <h3 className="font-display text-xl font-semibold">{name}</h3>
      <p className="font-mono text-2xl tabular-nums">{price}</p>
      <ul className="flex flex-col gap-2 text-sm">
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {action}
    </div>
  );
}
