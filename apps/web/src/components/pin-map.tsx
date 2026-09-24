import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type LatLng = { lat: number; lng: number };

const DEFAULT_CENTER: L.LatLngTuple = [14.5995, 120.9842];

// Same CSS-dot pin as the site dialog (Leaflet's default marker images are
// not bundled).
const pinIcon = L.divIcon({
  className: '',
  html: '<span style="display:block;width:18px;height:18px;border-radius:50%;background:#c2410c;border:3px solid #fff;box-shadow:0 0 0 1px #0006"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/** One exact point: click the map to drop the pin, drag it to adjust. */
export function PinMap({ label, value, onChange }: { label: string; value: LatLng | null; onChange: (next: LatLng) => void }) {
  const el = useRef<HTMLDivElement | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const map = useRef<L.Map | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current).setView(DEFAULT_CENTER, 11);
    // ponytail: OSM's public tiles, as in site-dialog.tsx.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => change.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (marker.current) {
      marker.current.setLatLng([value.lat, value.lng]);
    } else {
      marker.current = L.marker([value.lat, value.lng], { draggable: true, icon: pinIcon, keyboard: true, title: label })
        .addTo(m)
        .on('dragend', (e) => {
          const at = (e.target as L.Marker).getLatLng();
          change.current({ lat: at.lat, lng: at.lng });
        });
    }
  }, [value, label]);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text">{label}</span>
      <div ref={el} role="application" aria-label={`${label} map`} className="h-56 w-full rounded-mk-sm border border-border" />
      <span className="text-xs text-text-muted">
        {value ? `Pinned at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : 'Click the map to pin the exact spot.'}
      </span>
    </div>
  );
}
