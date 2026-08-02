export interface HazardDividerProps {
  label?: string;
  className?: string;
}

// A diagonal amber/black stripe rule used only to fence a blocking/danger region
// (reconciliation discrepancy, stop-work weather, unverified KYC). Never decorative;
// its presence means "do not proceed until resolved" (DESIGN.md §4). Uses the raw
// --steel-900 primitive rather than --color-text so the band stays amber/black even
// in the night-yard dark theme, where --color-text flips to cream.
export function HazardDivider({ label = 'Blocked: resolve before proceeding', className = '' }: HazardDividerProps) {
  return (
    <div
      role="separator"
      aria-label={label}
      className={['h-2 w-full rounded-sm', className].join(' ')}
      style={{
        backgroundImage: 'repeating-linear-gradient(135deg, var(--color-primary) 0 10px, var(--steel-900) 10px 20px)',
      }}
    />
  );
}
