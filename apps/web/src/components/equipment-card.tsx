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
}

const AVAILABILITY_PILL = {
  available: { tone: 'fleet-available' as const, label: 'Available', icon: <CheckIcon /> },
  deployed: { tone: 'fleet-deployed' as const, label: 'Deployed', icon: <TruckIcon /> },
  maintenance: { tone: 'fleet-maintenance' as const, label: 'In maintenance', icon: <WrenchIcon /> },
};

// The Figma "Product Info Card": schematic, model, make, Rent action. The
// unit of the storefront catalog grid.
export function EquipmentCard({ imageAlt, imageUrl, model, make, availabilityStatus, onRent }: EquipmentCardProps) {
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text">{model}</p>
          <p className="text-xs text-text-muted">{make}</p>
        </div>
        <Button size="default" variant="primary" onClick={onRent}>
          Rent
        </Button>
      </div>
    </div>
  );
}
