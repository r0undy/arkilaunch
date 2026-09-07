import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OpenMeteoAdapter, WeatherObservationError } from './open-meteo-adapter.js';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const VALID_BODY = {
  current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', precipitation: 'mm' },
  current: {
    temperature_2m: 30.1,
    wind_speed_10m: 12.4,
    precipitation: 0.2,
    weather_code: 3,
  },
};

describe('OpenMeteoAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the free keyless endpoint with the four current fields, explicit units, and Asia/Manila', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(200, VALID_BODY));

    const adapter = new OpenMeteoAdapter();
    await adapter.getConditions(14.676, 121.0437);

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as URL;
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(calledUrl.searchParams.get('latitude')).toBe('14.676');
    expect(calledUrl.searchParams.get('longitude')).toBe('121.0437');
    expect(calledUrl.searchParams.get('current')).toBe('temperature_2m,wind_speed_10m,precipitation,weather_code');
    expect(calledUrl.searchParams.get('temperature_unit')).toBe('celsius');
    expect(calledUrl.searchParams.get('wind_speed_unit')).toBe('kmh');
    expect(calledUrl.searchParams.get('precipitation_unit')).toBe('mm');
    expect(calledUrl.searchParams.get('timezone')).toBe('Asia/Manila');
    expect(calledUrl.searchParams.has('apikey')).toBe(false);

    const options = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps the current block straight onto WeatherObservation with no unit conversion', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(200, VALID_BODY));

    const adapter = new OpenMeteoAdapter();
    const result = await adapter.getConditions(14.676, 121.0437);

    expect(result).toEqual({ tempC: 30.1, windKph: 12.4, precipMm: 0.2, code: 3 });
  });

  // The safety-critical case: a missing field must throw, never coerce to
  // 0. An all-zero reading evaluates to severity 'none', which
  // severityMessage() renders as "No weather advisory in effect" -- a
  // fabricated all-clear for a construction site (see
  // packages/shared/src/weather-port.spec.ts's regression rationale).
  it('throws rather than defaulting a missing field to 0', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, {
        current_units: VALID_BODY.current_units,
        current: { temperature_2m: 30, precipitation: 0, weather_code: 1 },
      }),
    );

    const adapter = new OpenMeteoAdapter();
    const error = await adapter.getConditions(14.676, 121.0437).catch((e) => e);
    expect(error).toBeInstanceOf(WeatherObservationError);
    expect((error as WeatherObservationError).kind).toBe('malformed_response');
  });

  it('throws on a non-numeric field rather than coercing it', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, {
        current_units: VALID_BODY.current_units,
        current: { temperature_2m: 30, wind_speed_10m: null, precipitation: 0, weather_code: 1 },
      }),
    );

    const adapter = new OpenMeteoAdapter();
    await expect(adapter.getConditions(14.676, 121.0437)).rejects.toBeInstanceOf(WeatherObservationError);
  });

  // If Open-Meteo ever stopped honouring wind_speed_unit=kmh, a real 60 kph
  // gale reported as 16.7 (m/s) would compare false against every wind
  // threshold and render "No weather advisory in effect" -- silently. The
  // current_units literal check is the guard against exactly that.
  it('throws when current_units reports a unit other than what was requested', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, {
        current_units: { temperature_2m: '°C', wind_speed_10m: 'm/s', precipitation: 'mm' },
        current: { temperature_2m: 30, wind_speed_10m: 16.7, precipitation: 0, weather_code: 1 },
      }),
    );

    const adapter = new OpenMeteoAdapter();
    const error = await adapter.getConditions(14.676, 121.0437).catch((e) => e);
    expect(error).toBeInstanceOf(WeatherObservationError);
    expect((error as WeatherObservationError).kind).toBe('malformed_response');
  });

  it('throws on a non-2xx response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

    const adapter = new OpenMeteoAdapter();
    const error = await adapter.getConditions(14.676, 121.0437).catch((e) => e);
    expect(error).toBeInstanceOf(WeatherObservationError);
    expect((error as WeatherObservationError).kind).toBe('http_error');
    expect((error as WeatherObservationError).status).toBe(500);
  });

  it('throws on a 429 rate-limit response with a distinct kind', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(429, { error: 'rate limited' }));

    const adapter = new OpenMeteoAdapter();
    const error = await adapter.getConditions(14.676, 121.0437).catch((e) => e);
    expect(error).toBeInstanceOf(WeatherObservationError);
    expect((error as WeatherObservationError).kind).toBe('rate_limited');
    expect((error as WeatherObservationError).status).toBe(429);
  });

  it('throws on a network/timeout failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }),
    );

    const adapter = new OpenMeteoAdapter();
    const error = await adapter.getConditions(14.676, 121.0437).catch((e) => e);
    expect(error).toBeInstanceOf(WeatherObservationError);
    expect((error as WeatherObservationError).kind).toBe('timeout');
  });

  it('throws on a non-JSON body rather than crashing', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 200 }));

    const adapter = new OpenMeteoAdapter();
    await expect(adapter.getConditions(14.676, 121.0437)).rejects.toBeInstanceOf(WeatherObservationError);
  });

  it('does not retry after a failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

    const adapter = new OpenMeteoAdapter();
    await adapter.getConditions(14.676, 121.0437).catch(() => {});

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
