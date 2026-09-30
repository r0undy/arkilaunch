import { lazy, Suspense } from 'react';
import { MapPinned } from 'lucide-react';
import type { PaddingOptions } from 'maplibre-gl';
import type { TruckRoute } from '@arkilaunch/shared';
import type { LatLng } from './pin-map.js';

// Needs WebGL; without it RouteMap falls back to the printed coordinates.

export type Which = 'pickup' | 'dropoff';

export interface RouteMapCanvasProps {
  mode: 'edit' | 'view';
  pickup: LatLng | null;
  dropoff: LatLng | null;
  placing: Which;
  onPlace?: (which: Which, at: LatLng) => void;
  line?: [number, number][] | null;
  label: string;
  labels?: { pickup?: string | undefined; dropoff?: string | undefined };
  fitPadding?: number | PaddingOptions;
  hint?: string | null;
  initialCenter?: LatLng;
  sitePreview?: { at: LatLng; label: string; imageUrl: string | null };
}

export const TripCanvas = lazy(() => import('./route-map-gl.js'));

// Covers both waits: the lazy MapLibre chunk, then the style and first tiles.
export function MapSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-border/40 text-text-muted ${className}`}
    >
      <MapPinned className="h-8 w-8" aria-hidden="true" />
      <span className="text-sm">Loading the map…</span>
    </div>
  );
}

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
          <Suspense fallback={<MapSkeleton />}>
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
