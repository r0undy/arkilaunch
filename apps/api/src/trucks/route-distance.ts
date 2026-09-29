import { UnprocessableEntityException, ServiceUnavailableException } from '@nestjs/common';
import { tollHintsFromSteps, type TruckRoute } from '@arkilaunch/shared';
import { nominatimJson } from './nominatim.js';

// Road distance between two free-text Philippine addresses: Nominatim to
// geocode, ORS HGV to route (OSRM car route only as a flagged fallback). The result is only ever an
// ESTIMATE -- the admin confirms the km a customer is charged on.
//
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const ORS = 'https://api.openrouteservice.org/v2/directions/driving-hgv/geojson';
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
  const hits = (await nominatimJson(url)) as { lat?: string; lon?: string }[];
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
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: unknown };
    legs?: { steps?: { name?: string; ref?: string; destinations?: string; exits?: string }[] }[];
  }[];
};

type OrsBody = { features?: { geometry?: { coordinates?: unknown }; properties?: {
  summary?: { distance?: number; duration?: number };
  segments?: { steps?: { name?: string; instruction?: string; ref?: string }[] }[];
} }[] };

const routeLine = (coords: unknown): [number, number][] => Array.isArray(coords)
  ? coords.filter((c): c is number[] => Array.isArray(c) && c.length >= 2 && c.every((n) => Number.isFinite(n)))
    .map((c) => [c[0]!, c[1]!])
  : [];

export function parseOrs(body: OrsBody): TruckRoute {
  const feature = body.features?.[0];
  const meters = feature?.properties?.summary?.distance;
  if (!Number.isFinite(meters) || !feature?.geometry) throw new UnprocessableEntityException({ error: 'no_route_found' });
  const steps = feature.properties?.segments?.flatMap((segment) => segment.steps ?? []) ?? [];
  return {
    km: Math.max(0.1, Math.round(meters! / 100) / 10),
    minutes: Math.round((feature.properties?.summary?.duration ?? 0) / 60),
    line: routeLine(feature.geometry.coordinates),
    truckSafe: true,
    ...(steps.length ? { tollHints: tollHintsFromSteps(steps.map((step) => ({
      ...(step.name ?? step.instruction ? { name: step.name ?? step.instruction } : {}),
      ...(step.ref ? { ref: step.ref } : {}),
    }))) } : {}),
  };
}

// OSRM's answer as km, minutes and the simplified GeoJSON line. A route
// with no usable geometry still prices: `line` comes back empty.
export function parseOsrm(body: OsrmBody): TruckRoute {
  const route = body.routes?.[0];
  const meters = route?.distance;
  if (body.code !== 'Ok' || typeof meters !== 'number')
    throw new UnprocessableEntityException({ error: 'no_route_found' });
  const line = routeLine(route?.geometry?.coordinates);
  const steps = route?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  return {
    km: Math.max(0.1, Math.round(meters / 100) / 10),
    minutes: Math.round((route?.duration ?? 0) / 60),
    line,
    truckSafe: false,
    ...(steps.length ? { tollHints: tollHintsFromSteps(steps) } : {}),
  };
}

// A map pin is routed as-is; only a missing pin falls back to geocoding
// the typed place name. `steps` adds the turn list, read for toll hints.
export async function roadRoute(
  pickup: string,
  dropoff: string,
  pins: { a?: Pin; b?: Pin } = {},
  steps = false,
): Promise<TruckRoute> {
  const a = pins.a ?? (await geocode(pickup));
  const b = pins.b ?? (await geocode(dropoff));
  const key = process.env.ORS_API_KEY?.trim();
  if (key) {
    try {
      const response = await fetch(ORS, {
        method: 'POST',
        headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
        body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]], instructions: steps }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`ORS returned ${response.status}`);
      return parseOrs((await response.json()) as OrsBody);
    } catch (error) {
      console.warn('ORS HGV routing failed; using flagged car route', error);
    }
  }
  const body = (await getJson(
    new URL(`${OSRM}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=simplified&geometries=geojson${steps ? '&steps=true' : ''}`),
  )) as OsrmBody;
  return parseOsrm(body);
}
