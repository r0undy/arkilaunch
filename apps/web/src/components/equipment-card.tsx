import { Button } from './button.js';

export interface EquipmentCardProps {
  imageAlt: string;
  imageSrc?: string;
  model: string;
  make: string;
  onRent?: () => void;
}

// The Figma "Product Info Card": image, model, make, Rent action. The unit
// of the storefront catalog grid.
export function EquipmentCard({ imageAlt, imageSrc, model, make, onRent }: EquipmentCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-mk-lg bg-surface-mk p-4 shadow-mk-card">
      <div className="flex h-48 items-center justify-center overflow-hidden rounded-mk-sm bg-bg-mk-frame">
        {imageSrc ? (
          <img src={imageSrc} alt={imageAlt} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-text-muted">{imageAlt}</span>
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
