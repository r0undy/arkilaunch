import { Button } from './button.js';
import { EquipmentSchematic } from './equipment-schematic.js';
import { formatPeso } from '../lib/format.js';

export interface EquipmentCardProps {
  imageAlt: string;
  imageUrl?: string;
  model: string;
  make: string;
  // The catalog's upfront price; none reads "Price on request".
  rateValue?: number | null;
  rateType?: string | null;
  // No status label on the customer side: a "Deployed" badge on a card you
  // cannot rent is click bait. An unrentable unit is greyed and inert.
  unavailable?: boolean;
  rentLabel?: string;
  onRent?: () => void;
  // Rent now opens the configure-rental dialog rather than walking to the
  // listing, so the model name carries the route to the detail page. Without
  // it the catalog has no way through to /equipment/$equipmentId at all.
  onViewDetails?: () => void;
}

// The Figma "Product Info Card": schematic, model, make, Rent action. The
// unit of the storefront catalog grid.
export function EquipmentCard({
  imageAlt,
  imageUrl,
  model,
  make,
  rateValue = null,
  rateType = null,
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
      {/* Title, make and price, then the action under them (the AWS thumbnail
          card), so a long machine name never squeezes the button. */}
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="min-w-0">
          {/* The machine's name is the card's heading. As a <p> the whole
              catalog was one flat run of text with no way to jump between
              items. */}
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
              ? `${formatPeso(rateValue)} / ${rateType === 'daily' ? 'day' : 'hour'}`
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
