import { AlertIcon, CheckIcon, XCircleIcon } from './icons.js';

export type ConfidenceTone = 'match' | 'review' | 'failed';

export interface ConfidenceChipProps {
  tone: ConfidenceTone;
  confidence: number;
  fieldLabel?: string;
  className?: string;
}

const TONE_CLASSES: Record<ConfidenceTone, string> = {
  match: 'bg-recon-match text-white',
  // Below-gate chips are visually louder (DESIGN.md §4), not quieter: bold weight + a ring.
  review: 'bg-recon-review text-text font-semibold ring-2 ring-offset-1 ring-recon-review',
  failed: 'bg-recon-failed text-white font-semibold ring-2 ring-offset-1 ring-recon-failed',
};

const TONE_ICON: Record<ConfidenceTone, typeof CheckIcon> = {
  match: CheckIcon,
  review: AlertIcon,
  failed: XCircleIcon,
};

// The OCR per-field marker at reconciliation and KYC (DESIGN.md §4). The confidence
// value is always shown in mono next to the tone, never color-only.
export function ConfidenceChip({ tone, confidence, fieldLabel, className = '' }: ConfidenceChipProps) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      role={tone === 'match' ? undefined : 'status'}
      className={['inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm', TONE_CLASSES[tone], className].join(
        ' ',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {fieldLabel && <span>{fieldLabel}</span>}
      <span className="font-mono tabular-nums">{confidence.toFixed(2)}</span>
    </span>
  );
}
