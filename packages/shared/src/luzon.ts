import rings from './luzon-mainland.json' with { type: 'json' };

// OpenStreetMap relation 6995280 (Luzon island), ODbL 1.0, simplified to 0.001 degrees.
// Source: https://nominatim.openstreetmap.org/lookup?osm_ids=R6995280&format=jsonv2&polygon_geojson=1&polygon_threshold=0.001
// Coordinates are [longitude, latitude]. A tiny inland hole in the source is treated as service area.
export const LUZON_RINGS: number[][][] = rings;
export const LUZON_BOUNDS = [[119.35, 12.1], [124.65, 19.05]] as const;

function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    const dx = b[0]! - a[0]!;
    const dy = b[1]! - a[1]!;
    const cross = (lng - a[0]!) * dy - (lat - a[1]!) * dx;
    if (Math.abs(cross) < 1e-9 && lng >= Math.min(a[0]!, b[0]!) && lng <= Math.max(a[0]!, b[0]!) && lat >= Math.min(a[1]!, b[1]!) && lat <= Math.max(a[1]!, b[1]!)) return true;
    if ((a[1]! > lat) !== (b[1]! > lat) && lng < dx * (lat - a[1]!) / dy + a[0]!) inside = !inside;
  }
  return inside;
}

export function onLuzonMainland(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 12.53 || lat > 18.66 || lng < 119.74 || lng > 124.21) return false;
  return inRing(lng, lat, LUZON_RINGS[0]!);
}

// Outer ring plus island cutout: one translucent fill hides all non-service terrain.
export const LUZON_FOG = {
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [[100, 0], [140, 0], [140, 30], [100, 30], [100, 0]],
      LUZON_RINGS[0]!.slice().reverse(),
    ],
  },
};
