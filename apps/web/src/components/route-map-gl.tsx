import { useEffect, useRef, useState } from 'react';
import { LngLatBounds, Map as MapLibre, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre finds its worker relative to its own module, which Vite's
// pre-bundling (dev) and hashing (build) both break. Vite bundles the
// worker and its shared chunk into one file and hands over the URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
import type { RouteMapCanvasProps } from './route-map.js';

// The WebGL half of RouteMap, loaded on demand so MapLibre never reaches
// the main bundle. Vector tiles from OpenFreeMap (keyless, OSM data): its
// Liberty style ships the 3D building extrusions a tilted camera shows.
//
// ponytail: OpenFreeMap's public instance, like the OSM tiles before it.
// Self-host the tiles or move to a paid provider at real volume.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const MANILA: [number, number] = [120.9842, 14.5995];
const PITCH = 55;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// MapLibre paints with literal colours, so the design tokens are read off
// the root (the tenant's primary included) once the map mounts.
function token(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// A round lettered pin in the token colours. MapLibre positions the element
// through its own transform, so the pin is styled, never transformed.
function pinElement(letter: 'A' | 'B', label: string) {
  const el = document.createElement('div');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.textContent = letter;
  const pickup = letter === 'A';
  Object.assign(el.style, {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    font: '600 13px "IBM Plex Sans Condensed", sans-serif',
    background: pickup ? 'var(--yb-color-primary)' : 'var(--yb-color-accent)',
    color: pickup ? 'var(--yb-color-on-primary)' : '#fff',
    border: '3px solid #fff',
    boxShadow: '0 2px 6px rgb(16 21 27 / 40%)',
  });
  return el;
}

export default function RouteMapCanvas({ mode, pickup, dropoff, placing, onPlace, line, label }: RouteMapCanvasProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibre | null>(null);
  const markers = useRef<{ A: Marker | null; B: Marker | null }>({ A: null, B: null });
  const place = useRef({ placing, onPlace });
  place.current = { placing, onPlace };
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
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 },
      });
      m.addLayer({
        id: 'route-road',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'kind'], 'road'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': accent, 'line-width': 5 },
      });
      // Before the road route comes back the pins are joined as the crow
      // flies: dashed, so it never reads as the real route.
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

  // Pins: created once, then moved; draggable only in edit mode.
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
      const marker = new Marker({ element: pinElement(key, name), draggable: mode === 'edit' })
        .setLngLat([at.lng, at.lat])
        .addTo(m);
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        place.current.onPlace?.(which, { lat: ll.lat, lng: ll.lng });
      });
      markers.current[key] = marker;
    }
  }, [pickup, dropoff, mode]);

  // The line and the camera: the road route when there is one, else a
  // dashed straight line between the pins; fitted to whatever is shown.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const coords: [number, number][] =
      line && line.length > 1 ? line : pickup && dropoff ? [[pickup.lng, pickup.lat], [dropoff.lng, dropoff.lat]] : [];
    m.getSource<GeoJSONSource>('route')?.setData({
      type: 'FeatureCollection',
      features: coords.length
        ? [
            {
              type: 'Feature',
              properties: { kind: line && line.length > 1 ? 'road' : 'straight' },
              geometry: { type: 'LineString', coordinates: coords },
            },
          ]
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
    // fitBounds frames the pins top-down and drops the pitch, so the tilt
    // is put back once the fit settles. Read through a ref: only a new
    // route or pin moves the camera, never the toggle itself.
    m.once('moveend', () => {
      if (tiltedRef.current) m.easeTo({ pitch: PITCH, duration });
    });
    m.fitBounds(bounds, { padding: 56, maxZoom: 15, duration });
  }, [ready, line, pickup, dropoff]);

  function toggleTilt() {
    const next = !tilted;
    setTilted(next);
    map.current?.easeTo({ pitch: next ? PITCH : 0, duration: reducedMotion() ? 0 : 400 });
  }

  return (
    <div className="relative h-full w-full">
      <div ref={el} role="application" aria-label={label} className="h-full w-full" />
      <button
        type="button"
        onClick={toggleTilt}
        aria-pressed={tilted}
        className={[
          'absolute left-2 top-2 min-h-9 rounded-sm border px-3 text-xs font-semibold shadow-sm',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
          tilted ? 'border-text bg-text text-text-inverse' : 'border-border bg-surface text-text hover:bg-surface-sunk',
        ].join(' ')}
      >
        3D
      </button>
    </div>
  );
}
