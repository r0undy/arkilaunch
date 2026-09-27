import { UnprocessableEntityException, ServiceUnavailableException } from '@nestjs/common';
import type { TruckRoute } from '@arkilaunch/shared';

// Road distance between two free-text Philippine addresses: Nominatim to
// geocode, OSRM to route. Native fetch, no SDK. The result is only ever an
// ESTIMATE -- the admin confirms the km a customer is charged on.
//
// ponytail: public OSM demo servers (Nominatim 1 req/s, OSRM demo) -- fine
// for a pilot's handful of requests. Move to a self-hosted OSRM or a paid
// routing API (with truck profiles) before real volume.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'ArkiLaunch/0.1 (truck distance estimate)';

async function getJson(url: URL): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) throw new ServiceUnavailableException({ error: 'routing_unavailable' });
  return res.json();
}

async function geocode(place: string): Promise<{ lat: number; lon: number }> {
  const url = new URL(NOMINATIM);
  url.searchParams.set('q', place);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'ph');
  const hits = (await getJson(url)) as { lat?: string; lon?: string }[];
  const hit = Array.isArray(hits) ? hits[0] : undefined;
  const lat = Number(hit?.lat);
  const lon = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    throw new UnprocessableEntityException({ error: 'address_not_found', address: place });
  return { lat, lon };
}

type Pin = { lat: number; lon: number };

type OsrmBody = {
  code?: string;
  routes?: { distance?: number; duration?: number; geometry?: { coordinates?: unknown } }[];
};

// OSRM's answer as km, minutes and the simplified GeoJSON line. A route
// with no usable geometry still prices: `line` comes back empty.
export function parseOsrm(body: OsrmBody): TruckRoute {
  const route = body.routes?.[0];
  const meters = route?.distance;
  if (body.code !== 'Ok' || typeof meters !== 'number')
    throw new UnprocessableEntityException({ error: 'no_route_found' });
  const coords = route?.geometry?.coordinates;
  const line = Array.isArray(coords)
    ? coords
        .filter((c): c is number[] => Array.isArray(c) && c.length >= 2 && c.every((n) => Number.isFinite(n)))
        .map((c) => [c[0]!, c[1]!] as [number, number])
    : [];
  return {
    km: Math.max(0.1, Math.round(meters / 100) / 10),
    minutes: Math.round((route?.duration ?? 0) / 60),
    line,
  };
}

// A map pin is routed as-is; only a missing pin falls back to geocoding
// the typed place name.
export async function roadRoute(pickup: string, dropoff: string, pins: { a?: Pin; b?: Pin } = {}): Promise<TruckRoute> {
  const a = pins.a ?? (await geocode(pickup));
  const b = pins.b ?? (await geocode(dropoff));
  const body = (await getJson(
    new URL(`${OSRM}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=simplified&geometries=geojson`),
  )) as OsrmBody;
  return parseOsrm(body);
}
