import { Button } from './button.js';
import { EquipmentSchematic } from './equipment-schematic.js';
import { formatPeso } from '../lib/format.js';

export interface EquipmentCardProps {
  imageAlt: string;
  imageUrl?: string;
  model: string;
  make: string;
  rateValue?: number | null;
  unavailable?: boolean;
  rentLabel?: string;
  onRent?: () => void;
  onViewDetails?: () => void;
}

export function EquipmentCard({
  imageAlt,
  imageUrl,
  model,
  make,
  rateValue = null,
  unavailable = false,
  rentLabel = 'Rent',
  onRent,
  onViewDetails,
}: EquipmentCardProps) {
  return (
    <div
      className={[
'flex flex-col overflow-hidden rounded-md border border-border bg-surface transition-shadow hover:shadow-md',
        unavailable ? 'opacity-50 grayscale' : '',
      ].join(' ')}
    >
      <div
        aria-label={imageAlt}
        className={[
'relative flex h-52 items-center justify-center overflow-hidden bg-surface-sunk',
          imageUrl ? '' : 'p-6',
        ].join(' ')}
      >
        <EquipmentSchematic typeName={make} {...(imageUrl ? { imageUrl } : {})} className="max-h-full" />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="min-w-0">
          <h3 className="text-heading-md text-text">
            {onViewDetails ? (
              <button
                type="button"
                onClick={onViewDetails}
                className="rounded-sm text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {model}
              </button>
            ) : (
              model
            )}
          </h3>
          <p className="text-sm text-text-muted">{make}</p>
          <p className="mt-1 font-mono text-sm tabular-nums text-text" data-testid="equipment-card-price">
            {rateValue != null
              ? `${formatPeso(rateValue)} / hour`
              : 'Price on request'}
          </p>
        </div>
        <Button size="default" variant="primary" className="mt-auto self-start" disabled={unavailable} onClick={onRent}>
          {rentLabel}
        </Button>
      </div>
    </div>
  );
}
