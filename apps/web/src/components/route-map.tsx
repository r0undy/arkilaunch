import { lazy, Suspense } from 'react';
import type { PaddingOptions } from 'maplibre-gl';
import type { TruckRoute } from '@arkilaunch/shared';
import type { LatLng } from './pin-map.js';

// A truck trip on one map: pickup (A) and drop-off (B) pins, the road route
// between them, and its distance and drive time. The customer booking page
// drives the canvas in `edit` mode with its own panel; RouteMap is the
// read-only view the booking drawers show.
//
// The 3D map needs WebGL. Without it the booking page falls back to the flat
// Leaflet pin map, and RouteMap to the printed coordinates -- the pins still
// work, only the picture is simpler.

export type Which = 'pickup' | 'dropoff';

export interface RouteMapCanvasProps {
  mode: 'edit' | 'view';
  pickup: LatLng | null;
  dropoff: LatLng | null;
  placing: Which;
  onPlace?: (which: Which, at: LatLng) => void;
  line?: [number, number][] | null;
  label: string;
  // Address bubbles over the pins.
  labels?: { pickup?: string | undefined; dropoff?: string | undefined };
  // Keeps the fitted route clear of a panel floating over the map.
  fitPadding?: number | PaddingOptions;
  // A one-line instruction chip over the map.
  hint?: string | null;
}

export const TripCanvas = lazy(() => import('./route-map-gl.js'));

let webgl: boolean | null = null;
export function hasWebGL(): boolean {
  if (webgl === null) {
    try {
      const canvas = document.createElement('canvas');
      webgl = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

export function formatDrive(route: Pick<TruckRoute, 'km' | 'minutes'>): string {
  const h = Math.floor(route.minutes / 60);
  const m = route.minutes % 60;
  const time = h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
  return `~${route.km} km · ~${time} drive`;
}

export const pinned = (p: LatLng | null) => (p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'not pinned');

export interface RouteMapProps {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  route?: TruckRoute | null;
  className?: string;
}

export function RouteMap({ pickup, dropoff, route, className = 'h-80' }: RouteMapProps) {
  return (
    <div className="flex flex-col gap-2">
      {hasWebGL() && (
        <div className={['overflow-hidden rounded-md border border-border bg-surface-sunk', className].join(' ')}>
          <Suspense fallback={<p className="p-4 text-sm text-text-muted">Loading the map...</p>}>
            <TripCanvas mode="view" pickup={pickup} dropoff={dropoff} placing="pickup" line={route?.line ?? null} label="Trip map" />
          </Suspense>
        </div>
      )}
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-text-muted">
        <div className="flex gap-1">
          <dt>A pickup:</dt>
          <dd className="font-mono tabular-nums">{pinned(pickup)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>B drop-off:</dt>
          <dd className="font-mono tabular-nums">{pinned(dropoff)}</dd>
        </div>
        {route && (
          <div className="flex gap-1">
            <dt className="sr-only">Road route</dt>
            <dd className="font-mono font-semibold tabular-nums text-text">{formatDrive(route)} (estimate)</dd>
          </div>
        )}
      </dl>
      {route?.truckSafe === false && <p className="text-xs font-semibold text-warning">Car route - verify truck access</p>}
    </div>
  );
}
