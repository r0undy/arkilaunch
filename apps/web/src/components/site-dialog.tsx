import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { CustomerSiteResponse } from '@arkilaunch/shared';
import { apiErrorText, apiPost } from '../lib/api-client.js';
import { Modal } from './modal.js';
import { Button } from './button.js';
import { Input } from './input.js';

// Metro Manila: where most of the yard's work is.
const DEFAULT_CENTER: L.LatLngTuple = [14.5995, 120.9842];

// Leaflet's default marker points at image files the bundler does not
// ship, so the pin is a plain CSS dot instead.
const pinIcon = L.divIcon({
  className: '',
  html: '<span style="display:block;width:18px;height:18px;border-radius:50%;background:#c2410c;border:3px solid #fff;box-shadow:0 0 0 1px #0006"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/**
 * Where to deliver: typed address plus a pin the weather and deployment
 * screens read coordinates from. Click the map (or use your location) to
 * drop the pin; drag it to adjust.
 */
export function SiteDialog({
  open,
  onClose,
  customerId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  onCreated?: (site: CustomerSiteResponse) => void;
}) {
  const queryClient = useQueryClient();
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  function placePin(lat: number, lng: number) {
    setPin({ lat, lng });
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng], { draggable: true, icon: pinIcon, keyboard: true, title: 'Site location' })
        .addTo(map)
        .on('dragend', (e) => {
          const at = (e.target as L.Marker).getLatLng();
          setPin({ lat: at.lat, lng: at.lng });
        });
    }
  }

  // The modal mounts its body only while open, so the map is built on open
  // and torn down on close.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (!mapEl.current || mapRef.current) return;
      const map = L.map(mapEl.current).setView(DEFAULT_CENTER, 11);
      // ponytail: OSM's public tiles, fine at pilot volume under their usage
      // policy; move to a paid tile source if traffic grows.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      map.on('click', (e: L.LeafletMouseEvent) => placePin(e.latlng.lat, e.latlng.lng));
      mapRef.current = map;
    });
    return () => {
      cancelAnimationFrame(frame);
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [open]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocateError('This browser cannot share its location. Click the map instead.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        placePin(pos.coords.latitude, pos.coords.longitude);
        mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      () => {
        setLocating(false);
        setLocateError('Location was not shared. Click the map to place the pin.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const create = useMutation({
    mutationFn: () =>
      apiPost<CustomerSiteResponse>('/me/sites', {
        customerId,
        line1: line1.trim(),
        city: city.trim(),
        province: province.trim(),
        latitude: pin!.lat,
        longitude: pin!.lng,
      }),
    onSuccess: async (site) => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'sites'] });
      onCreated?.(site);
      setLine1('');
      setCity('');
      setProvince('');
      setPin(null);
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pin) create.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a project site" description="Where the machines are delivered." size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div
            ref={mapEl}
            role="application"
            aria-label="Map. Click to place the site pin."
            className="h-72 w-full overflow-hidden rounded-md border border-border"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-text-muted" aria-live="polite">
              {pin ? `Pinned at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : 'Click the map to place the pin.'}
            </p>
            <Button type="button" variant="secondary" loading={locating} onClick={useMyLocation}>
              Use my location
            </Button>
          </div>
          {locateError && <p className="text-sm text-error">{locateError}</p>}
        </div>
        <Input label="Street address" required maxLength={300} value={line1} onChange={(e) => setLine1(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="City" required maxLength={120} value={city} onChange={(e) => setCity(e.target.value)} />
          <Input label="Province" required maxLength={120} value={province} onChange={(e) => setProvince(e.target.value)} />
        </div>
        {create.isError && <p className="text-sm text-error">{apiErrorText(create.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!pin}>
            Save site
          </Button>
        </div>
      </form>
    </Modal>
  );
}
