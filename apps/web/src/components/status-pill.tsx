import type { ReactNode } from 'react';

// The two named semantic scales from DESIGN.md §2.1: reconciliation/OCR-confidence
// (PRD-F3/F6) and PAGASA weather-risk (PRD-F5). A pill is always icon + label + color
// (never color-only, DESIGN.md §6).
export type StatusTone =
  | 'recon-match'
  | 'recon-review'
  | 'recon-discrepancy'
  | 'recon-failed'
  | 'recon-approved'
  | 'weather-clear'
  | 'weather-yellow'
  | 'weather-orange'
  | 'weather-red'
  | 'weather-stale';

export interface StatusPillProps {
  tone: StatusTone;
  label: string;
  icon: ReactNode;
  value?: string;
  className?: string;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  'recon-match': 'bg-recon-match text-white',
  'recon-review': 'bg-recon-review text-text',
  'recon-discrepancy': 'bg-recon-discrepancy text-white',
  'recon-failed': 'bg-recon-failed text-white',
  'recon-approved': 'bg-recon-approved text-white',
  'weather-clear': 'bg-weather-clear text-white',
  'weather-yellow': 'bg-weather-yellow text-text',
  'weather-orange': 'bg-weather-orange text-text',
  'weather-red': 'bg-weather-red text-white',
  'weather-stale': 'bg-weather-stale text-white',
};

export function StatusPill({ tone, label, icon, value, className = '' }: StatusPillProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm font-medium',
        TONE_CLASSES[tone],
        className,
      ].join(' ')}
    >
      <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
        {icon}
      </span>
      {label}
      {value && <span className="font-mono tabular-nums">{value}</span>}
    </span>
  );
}
