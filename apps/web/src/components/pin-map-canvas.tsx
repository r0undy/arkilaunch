import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LUZON_BOUNDS, LUZON_FOG, onLuzonMainland } from '@arkilaunch/shared';
import { MapSkeleton } from './route-map.js';
import type { PinMapProps } from './pin-map.js';

const CENTER: L.LatLngTuple = [14.5995, 120.9842];
const BOUNDS: L.LatLngBoundsExpression = [[LUZON_BOUNDS[0][1], LUZON_BOUNDS[0][0]], [LUZON_BOUNDS[1][1], LUZON_BOUNDS[1][0]]];
const pinIcon = (fill: string) => L.divIcon({
  className: '',
  html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:${fill};border:3px solid #fff;box-shadow:0 0 0 1px #0006"></span>`,
  iconSize: [18, 18], iconAnchor: [9, 9],
});

function siteIcon(label: string, imageUrl: string | null) {
  const root = document.createElement('div');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', `Project site: ${label}`);
  root.style.cssText = 'display:grid;place-items:center;width:46px;height:46px;border:3px solid white;border-radius:50%;background:#1e5f8c;color:white;box-shadow:0 1px 6px #0008;overflow:hidden';
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover';
    img.onerror = () => { img.remove(); root.textContent = 'Site'; };
    root.append(img);
  } else root.textContent = 'Site';
  return L.divIcon({ className: '', html: root, iconSize: [46, 46], iconAnchor: [23, 23] });
}

export default function PinMapCanvas({ label, value, onChange, other, initialCenter, sitePreview }: PinMapProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const otherMarker = useRef<L.Marker | null>(null);
  const siteMarker = useRef<L.Marker | null>(null);
  const map = useRef<L.Map | null>(null);
  const validValue = useRef(value);
  validValue.current = value;
  const change = useRef(onChange);
  change.current = onChange;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const start = initialCenter ? [initialCenter.lat, initialCenter.lng] as L.LatLngTuple : CENTER;
    const m = L.map(el.current, { maxBounds: BOUNDS, maxBoundsViscosity: 1, minZoom: 7, zoomControl: true, scrollWheelZoom: false }).setView(start, 11);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    const fog = LUZON_FOG.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat!, lng!] as L.LatLngTuple));
    L.polygon(fog, { color: 'transparent', fillColor: '#758496', fillOpacity: 0.64, fillRule: 'evenodd', interactive: false }).addTo(m);
    tiles.on('load', () => { window.clearTimeout(timer); setReady(true); setError(null); });
    tiles.once('tileerror', () => { window.clearTimeout(timer); setReady(true); setError('Map tiles could not load. Try again later.'); });
    const timer = window.setTimeout(() => { setReady(true); setError('Map tiles are taking too long. Try again later.'); }, 12_000);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (onLuzonMainland(e.latlng.lat, e.latlng.lng)) { setError(null); change.current({ lat: e.latlng.lat, lng: e.latlng.lng }); }
      else setError('Choose a location on Luzon mainland.');
    });
    map.current = m;
    return () => { window.clearTimeout(timer); m.remove(); map.current = null; marker.current = null; otherMarker.current = null; siteMarker.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    siteMarker.current?.remove();
    siteMarker.current = null;
    if (!sitePreview || !onLuzonMainland(sitePreview.at.lat, sitePreview.at.lng)) return;
    siteMarker.current = L.marker([sitePreview.at.lat, sitePreview.at.lng], {
      icon: siteIcon(sitePreview.label, sitePreview.imageUrl), keyboard: true, title: `Project site: ${sitePreview.label}`,
    }).addTo(m);
  }, [sitePreview?.at.lat, sitePreview?.at.lng, sitePreview?.label, sitePreview?.imageUrl]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) { marker.current?.remove(); marker.current = null; return; }
    if (!onLuzonMainland(value.lat, value.lng)) return;
    if (marker.current) {
      marker.current.setLatLng([value.lat, value.lng]);
      marker.current.setIcon(pinIcon(label === 'Pickup pin' ? '#c2410c' : '#1e5f8c'));
      marker.current.getElement()?.setAttribute('title', label);
    }
    else marker.current = L.marker([value.lat, value.lng], { draggable: true, icon: pinIcon(label === 'Pickup pin' ? '#c2410c' : '#1e5f8c'), keyboard: true, title: label })
      .addTo(m).on('dragend', (e) => {
        const at = (e.target as L.Marker).getLatLng();
        if (onLuzonMainland(at.lat, at.lng)) { setError(null); change.current({ lat: at.lat, lng: at.lng }); }
        else if (validValue.current) { marker.current?.setLatLng([validValue.current.lat, validValue.current.lng]); setError('Choose a location on Luzon mainland.'); }
      });
    m.panTo([value.lat, value.lng]);
  }, [value, label]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!other?.value || !onLuzonMainland(other.value.lat, other.value.lng)) {
      otherMarker.current?.remove();
      otherMarker.current = null;
      return;
    }
    if (otherMarker.current) {
      otherMarker.current.setLatLng([other.value.lat, other.value.lng]);
      otherMarker.current.setIcon(pinIcon(other.label === 'Pickup pin' ? '#c2410c' : '#1e5f8c'));
      otherMarker.current.getElement()?.setAttribute('title', other.label);
    }
    else otherMarker.current = L.marker([other.value.lat, other.value.lng], {
      icon: pinIcon(other.label === 'Pickup pin' ? '#c2410c' : '#1e5f8c'), keyboard: true, title: other.label,
    }).addTo(m);
  }, [other?.value?.lat, other?.value?.lng, other?.label]);

  function onMapKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || !map.current) return;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80],
    };
    if (event.key in move) { event.preventDefault(); map.current.panBy(move[event.key]!, { animate: false }); }
    if (event.key === 'Enter') {
      event.preventDefault();
      const at = map.current.getCenter();
      if (onLuzonMainland(at.lat, at.lng)) { setError(null); change.current({ lat: at.lat, lng: at.lng }); }
      else setError('Choose a location on Luzon mainland.');
    }
  }

  return <div className="relative h-full w-full">
    <div ref={el} role="application" aria-label={`${label} map. Use arrow keys to move and Enter to pin.`} tabIndex={0} onKeyDown={onMapKeyDown} className="h-full w-full" />
    {!ready && <MapSkeleton className="absolute inset-0" />}
    {error && <p role="alert" className="absolute bottom-2 left-2 right-2 rounded bg-surface p-2 text-xs text-error shadow-sm">{error}</p>}
  </div>;
}
