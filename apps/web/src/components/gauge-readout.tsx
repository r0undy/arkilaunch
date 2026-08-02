import { ClockIcon } from './icons.js';

export type GaugeTrend = 'up' | 'down' | 'flat';

export interface GaugeReadoutProps {
  label: string;
  value: string;
  unit?: string;
  trend?: GaugeTrend;
  stale?: boolean;
  staleLabel?: string;
  className?: string;
}

const TREND_GLYPH: Record<GaugeTrend, string> = {
  up: '↑',
  down: '↓',
  flat: '→',
};

// DESIGN.md §4 domain components: "the interface's signature moment" -- a bezelled
// mono numeric tile for one key figure (diesel price, deposit balance, utilization %).
export function GaugeReadout({
  label,
  value,
  unit,
  trend,
  stale = false,
  staleLabel = 'stale',
  className = '',
}: GaugeReadoutProps) {
  return (
    <div
      className={['flex flex-col gap-1 rounded-md border-2 border-border-strong bg-surface px-4 py-3', className].join(
        ' ',
      )}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-medium tabular-nums text-text">{value}</span>
        {unit && <span className="font-mono text-base tabular-nums text-text-muted">{unit}</span>}
        {trend && (
          <span aria-hidden="true" className="font-mono text-lg text-text-muted">
            {TREND_GLYPH[trend]}
          </span>
        )}
      </div>
      {stale && (
        <span className="inline-flex w-fit items-center gap-1 rounded-sm bg-weather-stale px-2 py-0.5 text-xs font-medium text-white">
          <ClockIcon className="h-3 w-3" />
          {staleLabel}
        </span>
      )}
    </div>
  );
}
