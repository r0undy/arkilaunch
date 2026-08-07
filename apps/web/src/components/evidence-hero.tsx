import { ConfidenceChip } from './confidence-chip.js';
import { StatusPill } from './status-pill.js';
import { CheckIcon } from './icons.js';

// The landing hero's thesis, in one static composition: a paper EDTR (steel
// ink on a sunk paper surface) beside the reconciled reading it produces.
// BRAND.md's "one sentence that would never appear in AI slop for this
// category" made literal, not an empty aspect-video placeholder.
export function EvidenceHero() {
  return (
    <div className="flex flex-col gap-4 rounded-mk-lg bg-bg-mk-frame p-6 shadow-mk-inset sm:flex-row sm:items-center">
      <svg
        viewBox="0 0 160 200"
        className="h-48 w-40 shrink-0 self-center rounded-sm bg-surface-mk p-4 shadow-mk-card"
        role="img"
        aria-label="Handwritten field log, hours active 8.0, hours idle 1.0"
      >
        <rect x="0" y="0" width="160" height="200" fill="none" />
        <text x="12" y="24" className="font-display" fontSize="11" fill="var(--yb-color-border-strong)">
          EQUIPMENT DAILY TIME REPORT
        </text>
        <line x1="12" y1="34" x2="148" y2="34" stroke="var(--yb-color-border)" strokeWidth="1" />
        {Array.from({ length: 6 }).map((_, i) => (
          <line
            key={i}
            x1="12"
            y1={54 + i * 22}
            x2="148"
            y2={54 + i * 22}
            stroke="var(--yb-color-border)"
            strokeWidth="1"
          />
        ))}
        <path
          d="M16 48 Q40 40 60 48 T110 46"
          fill="none"
          stroke="var(--yb-color-text)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M16 70 Q50 62 90 70 T140 66"
          fill="none"
          stroke="var(--yb-color-text)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M16 92 Q45 84 80 92 T130 88"
          fill="none"
          stroke="var(--yb-color-primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>

      <div className="flex flex-1 flex-col gap-3">
        <p className="text-sm text-text-muted">Two independent logs, one reconciled reading:</p>
        <div className="flex flex-wrap gap-2">
          <ConfidenceChip tone="match" confidence={0.97} fieldLabel="Hours active" />
          <ConfidenceChip tone="match" confidence={0.94} fieldLabel="Hours idle" />
        </div>
        <StatusPill tone="recon-approved" label="Reconciled" icon={<CheckIcon />} value="delta 0.10h" />
      </div>
    </div>
  );
}
