import { useEffect, useRef, useState } from 'react';
import { LngLatBounds, Map as MapLibre, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Vite's pre-bundling and hashing break MapLibre's relative worker lookup, so Vite bundles the worker and passes its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
import type { RouteMapCanvasProps } from './route-map.js';

// Loaded on demand so MapLibre never reaches the main bundle.
// ponytail: OpenFreeMap's public instance; self-host tiles or move to a paid provider at real volume.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const MANILA: [number, number] = [120.9842, 14.5995];
const PITCH = 55;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// MapLibre paints literal colours, so the tokens are read off the root at mount.
function token(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// MapLibre owns the root's transform, so only the children animate.
function pinElement(letter: 'A' | 'B', label: string) {
  const pickup = letter === 'A';
  const fill = pickup ? 'var(--yb-color-primary)' : 'var(--yb-color-accent)';
  const ink = pickup ? 'var(--yb-color-on-primary)' : '#fff';
  const root = document.createElement('div');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', label);
  Object.assign(root.style, { width: '34px', height: '46px', cursor: 'grab' });
  root.innerHTML = `
    <div data-bubble style="position:absolute;bottom:50px;left:50%;transform:translateX(-50%);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:3px 8px;border-radius:4px;background:var(--yb-color-surface);color:var(--yb-color-text);font:600 12px var(--font-sans);box-shadow:0 1px 4px rgb(16 21 27 / 30%);display:none"></div>
    <svg data-drop width="34" height="46" viewBox="0 0 34 46" aria-hidden="true" style="overflow:visible;display:block">
      <ellipse cx="17" cy="44" rx="7" ry="2.5" fill="rgb(16 21 27 / 35%)"/>
      <path d="M17 43C17 43 2 27 2 17A15 15 0 0 1 32 17C32 27 17 43 17 43Z" fill="${fill}" stroke="#fff" stroke-width="2.5"/>
      <text x="17" y="21.5" text-anchor="middle" style="font:700 14px var(--font-sans)" fill="${ink}">${letter}</text>
    </svg>`;
  if (!reducedMotion()) {
    root.querySelector('[data-drop]')?.animate(
      [
        { transform: 'translateY(-18px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.2)' },
    );
  }
  return root;
}

function setBubble(marker: Marker | null, text: string | undefined) {
  const bubble = marker?.getElement().querySelector<HTMLElement>('[data-bubble]');
  if (!bubble) return;
  bubble.textContent = text ?? '';
  bubble.style.display = text ? 'block' : 'none';
}

export default function RouteMapCanvas({
  mode,
  pickup,
  dropoff,
  placing,
  onPlace,
  line,
  label,
  labels,
  fitPadding = 56,
  hint,
}: RouteMapCanvasProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibre | null>(null);
  const markers = useRef<{ A: Marker | null; B: Marker | null }>({ A: null, B: null });
  const place = useRef({ placing, onPlace });
  place.current = { placing, onPlace };
  const padding = useRef(fitPadding);
  padding.current = fitPadding;
  const [ready, setReady] = useState(false);
  const [tilted, setTilted] = useState(true);
  const tiltedRef = useRef(tilted);
  tiltedRef.current = tilted;

  useEffect(() => {
    if (!el.current) return;
    const m = new MapLibre({
      container: el.current,
      style: STYLE,
      center: MANILA,
      zoom: 11,
      pitch: PITCH,
      // One finger scrolls the page on a phone; two move the map.
      cooperativeGestures: true,
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    m.on('load', () => {
      const accent = token('--yb-color-accent', '#1e5f8c');
      const accentDark = token('--yb-color-accent-hover', '#164a6e');
      const width = (base: number): ['interpolate', ['linear'], ['zoom'], ...number[]] => [
        'interpolate', ['linear'], ['zoom'], 8, base * 0.5, 12, base, 16, base * 2,
      ];
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': accentDark, 'line-width': width(9) },
      });
      m.addLayer({
        id: 'route-road',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': accent, 'line-width': width(5.5) },
      });
      m.addLayer({
        id: 'route-straight',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'kind'], 'straight'],
        paint: { 'line-color': accent, 'line-width': 3, 'line-dasharray': [2, 2] },
      });
      setReady(true);
    });
    if (mode === 'edit') {
      m.on('click', (e) => place.current.onPlace?.(place.current.placing, { lat: e.lngLat.lat, lng: e.lngLat.lng }));
    }
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      markers.current = { A: null, B: null };
    };
  }, [mode]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const [key, at, which, name] of [
      ['A', pickup, 'pickup', 'Pickup pin'],
      ['B', dropoff, 'dropoff', 'Drop-off pin'],
    ] as const) {
      const existing = markers.current[key];
      if (!at) {
        existing?.remove();
        markers.current[key] = null;
        continue;
      }
      if (existing) {
        existing.setLngLat([at.lng, at.lat]);
        continue;
      }
      const marker = new Marker({ element: pinElement(key, name), anchor: 'bottom', draggable: mode === 'edit' })
        .setLngLat([at.lng, at.lat])
        .addTo(m);
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        place.current.onPlace?.(which, { lat: ll.lat, lng: ll.lng });
      });
      markers.current[key] = marker;
    }
    setBubble(markers.current.A, labels?.pickup);
    setBubble(markers.current.B, labels?.dropoff);
  }, [pickup, dropoff, mode, labels?.pickup, labels?.dropoff]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const road = Boolean(line && line.length > 1);
    const coords: [number, number][] =
      road ? line! : pickup && dropoff ? [[pickup.lng, pickup.lat], [dropoff.lng, dropoff.lat]] : [];
    m.getSource<GeoJSONSource>('route')?.setData({
      type: 'FeatureCollection',
      features: coords.length
        ? [{ type: 'Feature', properties: { kind: road ? 'road' : 'straight' }, geometry: { type: 'LineString', coordinates: coords } }]
        : [],
    });
    const points = coords.length ? coords : [pickup, dropoff].filter((p) => p !== null).map((p) => [p.lng, p.lat] as [number, number]);
    if (points.length === 0) return;
    const duration = reducedMotion() ? 0 : 700;
    if (points.length === 1) {
      m.easeTo({ center: points[0]!, zoom: Math.max(m.getZoom(), 14), duration, pitch: tiltedRef.current ? PITCH : 0 });
      return;
    }
    const bounds = points.reduce((b, p) => b.extend(p), new LngLatBounds(points[0]!, points[0]!));
    // Read through a ref: only a new route or pin moves the camera, never the toggle.
    m.fitBounds(bounds, { padding: padding.current, maxZoom: 15, duration, pitch: tiltedRef.current ? PITCH : 0 });
  }, [ready, line, pickup, dropoff]);

  function toggleTilt() {
    const next = !tilted;
    setTilted(next);
    map.current?.easeTo({ pitch: next ? PITCH : 0, duration: reducedMotion() ? 0 : 400 });
  }

  return (
    <div className="relative h-full w-full">
      <div ref={el} role="application" aria-label={label} className="h-full w-full" />
      {hint && (
        <p
          aria-live="polite"
          className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-text/85 px-3 py-1.5 text-xs font-semibold text-text-inverse shadow-sm"
        >
          {hint}
        </p>
      )}
      <button
        type="button"
        onClick={toggleTilt}
        aria-pressed={tilted}
        className={[
'absolute right-12 top-2.5 min-h-9 rounded-sm border px-3 text-xs font-semibold shadow-sm',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
          tilted ? 'border-text bg-text text-text-inverse' : 'border-border bg-surface text-text hover:bg-surface-sunk',
        ].join(' ')}
      >
        3D
      </button>
    </div>
  );
}
