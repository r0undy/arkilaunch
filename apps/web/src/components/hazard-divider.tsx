export interface HazardDividerProps {
  label?: string;
  className?: string;
}

// Raw --steel-900, not --color-text, so the band stays amber/black in the dark theme.
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
