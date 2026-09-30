import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseOrs, roadRoute } from './route-distance.js';
import { routeCities } from './route-cities.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('truck routing providers', () => {
  it('reads HGV GeoJSON and its duration', () => {
    expect(parseOrs({ features: [{ geometry: { coordinates: [[121, 14], [122, 15]] },
      properties: { summary: { distance: 5000, duration: 600 }, segments: [] } }] }))
      .toMatchObject({ km: 5, minutes: 10, truckSafe: true });
  });

  it('flags an OSRM fallback when HGV routing fails', async () => {
    vi.stubEnv('ORS_API_KEY', 'fixture-key');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 5000, duration: 600,
        geometry: { coordinates: [[121, 14], [122, 15]] } }] }) } as Response);
    const route = await roadRoute('Pasig', 'Makati', { a: { lon: 121.085, lat: 14.576 }, b: { lon: 121.024, lat: 14.554 } });
    expect(route.truckSafe).toBe(false);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.heigit.org/openrouteservice/v2/directions/driving-hgv/geojson');
  });

  it('rejects an off-island pin before calling routing providers', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(roadRoute('Cebu', 'Manila', { a: { lon: 123.8854, lat: 10.3157 }, b: { lon: 120.9842, lat: 14.5995 } }))
      .rejects.toMatchObject({ response: { error: 'outside_luzon_mainland' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the first occurrence of each city in route order', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const lon = Number(new URL(String(url)).searchParams.get('lon'));
      return { ok: true, json: async () => ({ address: { city: lon < 121.05 ? 'Pasig' : 'Makati', province: 'Metro Manila' } }) } as Response;
    });
    expect(await routeCities([[121, 14], [121.1, 14]])).toEqual([
      { city: 'Pasig', province: 'Metro Manila' }, { city: 'Makati', province: 'Metro Manila' },
    ]);
  });
});
