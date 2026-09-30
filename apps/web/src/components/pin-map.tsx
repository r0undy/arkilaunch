import { lazy, Suspense } from 'react';
import { MapSkeleton } from './route-map.js';

export type LatLng = { lat: number; lng: number };
export interface PinMapProps {
  label: string;
  value: LatLng | null;
  onChange: (next: LatLng) => void;
  className?: string;
  fill?: boolean;
  other?: { label: string; value: LatLng | null };
  initialCenter?: LatLng;
  sitePreview?: { at: LatLng; label: string; imageUrl: string | null };
}

const Canvas = lazy(() => import('./pin-map-canvas.js'));

export function PinMap(props: PinMapProps) {
  return (
    <div className={`flex flex-col gap-1 ${props.fill ? 'h-full' : ''}`}>
      <span className="text-sm font-medium text-text">{props.label}</span>
      <div className={`relative w-full overflow-hidden rounded-md border border-border ${props.fill ? 'min-h-0 flex-1' : (props.className ?? 'h-56')}`}>
        <Suspense fallback={<MapSkeleton />}><Canvas {...props} /></Suspense>
      </div>
      <span className="text-xs text-text-muted">
        {props.value ? `Pinned at ${props.value.lat.toFixed(5)}, ${props.value.lng.toFixed(5)}` : 'Click the map, or focus it and use arrow keys then Enter to pin.'}
      </span>
    </div>
  );
}
