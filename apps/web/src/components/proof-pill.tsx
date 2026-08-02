export interface ProofPillProps {
  value: string;
  unit: string;
  rotation?: '-1' | '0' | '1';
}

const ROTATION_CLASS: Record<NonNullable<ProofPillProps['rotation']>, string> = {
  '-1': '-rotate-1',
  '0': '',
  '1': 'rotate-1',
};

// DSD §4 ProofPill: oversized pill, numeral in --color-ink-mk, unit in
// --color-primary-ink (never raw amber-on-white). Three overlap with
// -space-x-6 at desktop, each at a distinct slight rotation.
export function ProofPill({ value, unit, rotation = '0' }: ProofPillProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-1 rounded-pill bg-surface-mk px-8 py-6 shadow-mk-card',
        ROTATION_CLASS[rotation],
      ].join(' ')}
    >
      <span className="font-mono text-3xl font-medium tabular-nums text-ink-mk">{value}</span>
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-primary-ink">{unit}</span>
    </div>
  );
}
