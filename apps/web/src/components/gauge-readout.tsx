import { Clock } from 'lucide-react';

export interface GaugeReadoutProps {
  label: string;
  value: string;
  unit?: string;
  stale?: boolean;
  staleLabel?: string;
  className?: string;
}

// DESIGN.md §4 domain components: "the interface's signature moment" -- a bezelled
// mono numeric tile for one key figure (diesel price, deposit balance, utilization %).
export function GaugeReadout({
  label,
  value,
  unit,
  stale = false,
  staleLabel = 'stale',
  className = '',
}: GaugeReadoutProps) {
  return (
    <div
      className={['flex flex-col gap-1 rounded-md border border-border bg-surface px-4 py-3', className].join(
        ' ',
      )}
    >
      <span className="text-sm font-medium text-text-muted">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-medium tabular-nums text-text">{value}</span>
        {unit && <span className="font-mono text-base tabular-nums text-text-muted">{unit}</span>}
      </div>
      {stale && (
        <span className="inline-flex w-fit items-center gap-1 rounded-xs bg-weather-stale px-2 py-0.5 text-xs font-medium text-white">
          <Clock className="h-3 w-3" />
          {staleLabel}
        </span>
      )}
    </div>
  );
}
