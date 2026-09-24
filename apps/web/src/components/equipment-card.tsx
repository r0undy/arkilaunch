import { Button } from './button.js';
import { EquipmentSchematic } from './equipment-schematic.js';
import { StatusPill } from './status-pill.js';
import { CheckIcon, TruckIcon, WrenchIcon } from './icons.js';

export interface EquipmentCardProps {
  imageAlt: string;
  imageUrl?: string;
  model: string;
  make: string;
  availabilityStatus?: 'available' | 'deployed' | 'maintenance';
  onRent?: () => void;
  // Rent now opens the configure-rental dialog rather than walking to the
  // listing, so the model name carries the route to the detail page. Without
  // it the catalog has no way through to /equipment/$equipmentId at all.
  onViewDetails?: () => void;
}

const AVAILABILITY_PILL = {
  available: { tone: 'fleet-available' as const, label: 'Available', icon: <CheckIcon /> },
  deployed: { tone: 'fleet-deployed' as const, label: 'Deployed', icon: <TruckIcon /> },
  maintenance: { tone: 'fleet-maintenance' as const, label: 'In maintenance', icon: <WrenchIcon /> },
};

// The Figma "Product Info Card": schematic, model, make, Rent action. The
// unit of the storefront catalog grid.
export function EquipmentCard({
  imageAlt,
  imageUrl,
  model,
  make,
  availabilityStatus,
  onRent,
  onViewDetails,
}: EquipmentCardProps) {
  const pill = availabilityStatus ? AVAILABILITY_PILL[availabilityStatus] : null;
  return (
    <div className="flex flex-col gap-4 rounded-mk-lg bg-surface-mk p-4 shadow-mk-card">
      <div
        aria-label={imageAlt}
        className={[
          'relative flex h-48 items-center justify-center overflow-hidden rounded-mk-sm bg-bg-mk-frame',
          imageUrl ? '' : 'p-6',
        ].join(' ')}
      >
        <EquipmentSchematic typeName={make} {...(imageUrl ? { imageUrl } : {})} className="max-h-full" />
        {pill && (
          <div className="absolute right-3 top-3">
            <StatusPill tone={pill.tone} label={pill.label} icon={pill.icon} />
          </div>
        )}
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
        </div>
        <Button size="default" variant="primary" className="shrink-0" onClick={onRent}>
          Rent
        </Button>
      </div>
    </div>
  );
}
