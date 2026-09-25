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
  // No price because the viewer is not verified, not because none is set.
  priceLocked?: boolean;
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
  priceLocked = false,
  unavailable = false,
  rentLabel = 'Rent',
  onRent,
  onViewDetails,
}: EquipmentCardProps) {
  return (
    <div
      className={[
        'flex flex-col gap-4 rounded-mk-lg bg-surface-mk p-4 shadow-mk-card',
        unavailable ? 'opacity-50 grayscale' : '',
      ].join(' ')}
    >
      <div
        aria-label={imageAlt}
        className={[
          'relative flex h-48 items-center justify-center overflow-hidden rounded-mk-sm bg-bg-mk-frame',
          imageUrl ? '' : 'p-6',
        ].join(' ')}
      >
        <EquipmentSchematic typeName={make} {...(imageUrl ? { imageUrl } : {})} className="max-h-full" />
      </div>
      {/* min-w-0 so the name can shrink instead of forcing the row wider, and
          the action never gives up its width to a long machine name. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {/* The machine's name is the card's heading. As a <p> the whole
              catalog was one flat run of text with no way to jump between
              items. */}
          <h3 className="text-sm font-medium text-text">
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
          <p className="text-xs text-text-muted">{make}</p>
          <p className="text-sm font-semibold text-text" data-testid="equipment-card-price">
            {rateValue != null
              ? `${formatPeso(rateValue)} / ${rateType === 'daily' ? 'day' : 'hour'}`
              : priceLocked
                ? 'Verify your company to see pricing'
                : 'Price on request'}
          </p>
        </div>
        <Button size="default" variant="primary" className="shrink-0" disabled={unavailable} onClick={onRent}>
          {rentLabel}
        </Button>
      </div>
    </div>
  );
}
