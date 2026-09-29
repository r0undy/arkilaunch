import type { RouteCity } from '@arkilaunch/shared';

const REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'ArkiLaunch/0.1 (truck route cities)';
let nextRequestAt = 0;
let queue = Promise.resolve();

const distanceKm = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export function sampleRoute(line: [number, number][]): [number, number][] {
  if (line.length < 2) return line;
  const lengths = line.slice(1).map((point, i) => distanceKm(line[i]!, point));
  const total = lengths.reduce((sum, km) => sum + km, 0);
  const intervals = Math.min(21, Math.max(1, Math.ceil(total / 5)));
  const samples: [number, number][] = [];
  for (let i = 0; i <= intervals; i++) {
    const target = total * i / intervals;
    let covered = 0;
    let point = line.at(-1)!;
    for (let j = 0; j < lengths.length; j++) {
      const length = lengths[j]!;
      if (covered + length >= target) {
        const fraction = length ? (target - covered) / length : 0;
        const a = line[j]!;
        const b = line[j + 1]!;
        point = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
        break;
      }
      covered += length;
    }
    samples.push(point);
  }
  return samples;
}

async function reverse(point: [number, number]): Promise<RouteCity | null> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + 1000;
    const url = new URL(REVERSE);
    url.searchParams.set('lat', String(point[1]));
    url.searchParams.set('lon', String(point[0]));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('zoom', '10');
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
    const body = await response.json() as { address?: Record<string, string> };
    const address = body.address ?? {};
    const city = address.city ?? address.municipality ?? address.town ?? address.city_district;
    return city ? { city, province: address.province ?? address.state ?? '' } : null;
  } finally {
    release();
  }
}

export async function routeCities(line: [number, number][]): Promise<RouteCity[]> {
  const cities: RouteCity[] = [];
  const seen = new Set<string>();
  for (const point of sampleRoute(line)) {
    const place = await reverse(point);
    if (!place) continue;
    const key = `${place.city}|${place.province}`.toLocaleLowerCase();
    if (!seen.has(key)) { seen.add(key); cities.push(place); }
  }
  return cities;
}
