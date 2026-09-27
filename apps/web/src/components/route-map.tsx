import { lazy, Suspense, useState } from 'react';
import type { TruckRoute } from '@arkilaunch/shared';
import { PinMap, type LatLng } from './pin-map.js';

// A truck trip on one map: pickup (A) and drop-off (B) pins, the road route
// between them, and its distance and drive time. `edit` places and drags
// pins; `view` only shows them (the staff drawer).
//
// The 3D map needs WebGL. Without it (an old phone, a locked-down browser)
// the flat Leaflet pin map stands in for editing, and viewing falls back to
// the coordinates -- the pins still work, only the picture is simpler.

export type Which = 'pickup' | 'dropoff';

export interface RouteMapCanvasProps {
  mode: 'edit' | 'view';
  pickup: LatLng | null;
  dropoff: LatLng | null;
  placing: Which;
  onPlace?: (which: Which, at: LatLng) => void;
  line?: [number, number][] | null;
  label: string;
}

const Canvas = lazy(() => import('./route-map-gl.js'));

let webgl: boolean | null = null;
function hasWebGL(): boolean {
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

const pinned = (p: LatLng | null) => (p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'not pinned');

export interface RouteMapProps {
  mode: 'edit' | 'view';
  pickup: LatLng | null;
  dropoff: LatLng | null;
  onChange?: (which: Which, at: LatLng) => void;
  route?: TruckRoute | null;
  className?: string;
}

export function RouteMap({ mode, pickup, dropoff, onChange, route, className = 'h-80' }: RouteMapProps) {
  const [placing, setPlacing] = useState<Which>('pickup');
  // After the pickup is dropped, the next click places the drop-off.
  const place = (which: Which, at: LatLng) => {
    onChange?.(which, at);
    if (which === 'pickup' && !dropoff) setPlacing('dropoff');
  };
  const gl = hasWebGL();

  return (
    <div className="flex flex-col gap-2">
      {mode === 'edit' && (
        <div role="radiogroup" aria-label="Pin to place" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">Placing:</span>
          {(['pickup', 'dropoff'] as const).map((which) => (
            <button
              key={which}
              type="button"
              role="radio"
              aria-checked={placing === which}
              onClick={() => setPlacing(which)}
              className={[
                'inline-flex min-h-9 items-center gap-2 rounded-sm border px-3 font-semibold',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
                placing === which ? 'border-text bg-surface-sunk text-text' : 'border-border text-text-muted hover:text-text',
              ].join(' ')}
            >
              <span
                aria-hidden
                className={[
                  'grid h-5 w-5 place-items-center rounded-full text-[11px]',
                  which === 'pickup' ? 'bg-primary text-on-primary' : 'bg-accent text-white',
                ].join(' ')}
              >
                {which === 'pickup' ? 'A' : 'B'}
              </span>
              {which === 'pickup' ? 'Pickup' : 'Drop-off'}
            </button>
          ))}
        </div>
      )}

      {gl ? (
        <div className={['overflow-hidden rounded-md border border-border bg-surface-sunk', className].join(' ')}>
          <Suspense fallback={<p className="p-4 text-sm text-text-muted">Loading the map...</p>}>
            <Canvas
              mode={mode}
              pickup={pickup}
              dropoff={dropoff}
              placing={placing}
              onPlace={place}
              line={route?.line ?? null}
              label={mode === 'edit' ? 'Trip map: click to place the selected pin, drag a pin to move it' : 'Trip map'}
            />
          </Suspense>
        </div>
      ) : mode === 'edit' ? (
        <PinMap
          label={placing === 'pickup' ? 'Pickup pin' : 'Drop-off pin'}
          value={placing === 'pickup' ? pickup : dropoff}
          onChange={(at) => place(placing, at)}
        />
      ) : null}

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
      {mode === 'edit' && !pickup && (
        <p className="text-xs text-text-muted">Click the map to pin the exact pickup spot, then the drop-off.</p>
      )}
    </div>
  );
}
