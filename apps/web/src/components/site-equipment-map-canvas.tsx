import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LUZON_BOUNDS, LUZON_FOG, type SiteHubResponse } from '@arkilaunch/shared';
import { MapSkeleton } from './route-map.js';

type Unit = SiteHubResponse['units'][number];

function siteMarker(units: Unit[]) {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;align-items:center;justify-content:center;width:54px;height:54px;border:3px solid white;border-radius:50%;background:#1e5f8c;box-shadow:0 1px 6px #0008;overflow:visible';
  const photo = units.find((unit) => unit.photoUrl)?.photoUrl;
  if (photo) {
    const image = document.createElement('img');
    image.src = photo;
    image.alt = '';
    image.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    image.onerror = () => { image.remove(); const symbol = document.createElement('span'); symbol.textContent = '⌖'; symbol.style.cssText = 'font-size:28px;color:white'; root.prepend(symbol); };
    root.append(image);
  } else {
    const symbol = document.createElement('span');
    symbol.textContent = '⌖';
    symbol.style.cssText = 'font-size:28px;color:white';
    root.append(symbol);
  }
  if (units.length > 1) {
    const count = document.createElement('span');
    count.textContent = String(units.length);
    count.style.cssText = 'position:absolute;right:-8px;bottom:-5px;min-width:22px;padding:2px;border-radius:12px;background:#1e5f8c;color:white;text-align:center;font:bold 12px sans-serif';
    root.append(count);
  }
  return L.divIcon({ className: '', html: root, iconSize: [54, 54], iconAnchor: [27, 27] });
}

function sitePopup(units: Unit[]) {
  const root = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = units.length ? `${units.length} machine${units.length === 1 ? '' : 's'} on site` : 'Project site';
  root.append(title);
  const list = document.createElement('ul');
  list.style.cssText = 'display:grid;gap:6px;margin:8px 0 0;padding:0;list-style:none';
  for (const unit of units) {
    const item = document.createElement('li');
    item.style.cssText = 'display:flex;align-items:center;gap:8px';
    if (unit.photoUrl) {
      const image = document.createElement('img');
      image.src = unit.photoUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.style.cssText = 'width:36px;height:36px;object-fit:cover;border-radius:4px';
      item.append(image);
    }
    const name = document.createElement('span');
    name.textContent = unit.name;
    item.append(name);
    list.append(item);
  }
  root.append(list);
  return root;
}

export default function SiteEquipmentMapCanvas({ site, units }: { site: SiteHubResponse['site']; units: Unit[] }) {
  const el = useRef<HTMLDivElement | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const bounds: L.LatLngBoundsExpression = [[LUZON_BOUNDS[0][1], LUZON_BOUNDS[0][0]], [LUZON_BOUNDS[1][1], LUZON_BOUNDS[1][0]]];
    const map = L.map(el.current, { maxBounds: bounds, maxBoundsViscosity: 1, minZoom: 7 }).setView([site.latitude, site.longitude], 13);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const fog = LUZON_FOG.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat!, lng!] as L.LatLngTuple));
    L.polygon(fog, { color: 'transparent', fillColor: '#758496', fillOpacity: 0.64, fillRule: 'evenodd', interactive: false }).addTo(map);
    marker.current = L.marker([site.latitude, site.longitude], { icon: siteMarker(units), keyboard: true, title: `${site.address}: ${units.length} machines on site` }).addTo(map);
    marker.current.bindPopup(sitePopup(units));
    tiles.on('load', () => { window.clearTimeout(timer); setReady(true); setError(null); });
    tiles.once('tileerror', () => { window.clearTimeout(timer); setReady(true); setError('Map tiles could not load. Try again later.'); });
    const timer = window.setTimeout(() => { setReady(true); setError('Map tiles are taking too long. Try again later.'); }, 12_000);
    return () => { window.clearTimeout(timer); map.remove(); marker.current = null; };
  }, [site.latitude, site.longitude]);
  useEffect(() => {
    marker.current?.setIcon(siteMarker(units));
    marker.current?.bindPopup(sitePopup(units));
    marker.current?.getElement()?.setAttribute('title', `${site.address}: ${units.length} machines on site`);
  }, [units, site.address]);
  return <div className="relative h-full w-full">
    <div ref={el} role="application" aria-label="Project site and equipment map" className="h-full w-full" />
    {!ready && <MapSkeleton className="absolute inset-0" />}
    {error && <p role="alert" className="absolute bottom-2 left-2 right-2 rounded bg-surface p-2 text-xs text-error shadow-sm">{error}</p>}
  </div>;
}
