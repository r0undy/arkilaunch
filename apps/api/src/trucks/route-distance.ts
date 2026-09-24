import { UnprocessableEntityException, ServiceUnavailableException } from '@nestjs/common';

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

export async function roadDistanceKm(pickup: string, dropoff: string): Promise<number> {
  const a = await geocode(pickup);
  const b = await geocode(dropoff);
  const body = (await getJson(
    new URL(`${OSRM}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`),
  )) as { code?: string; routes?: { distance?: number }[] };
  const meters = body.routes?.[0]?.distance;
  if (body.code !== 'Ok' || typeof meters !== 'number')
    throw new UnprocessableEntityException({ error: 'no_route_found' });
  return Math.max(0.1, Math.round(meters / 100) / 10);
}
