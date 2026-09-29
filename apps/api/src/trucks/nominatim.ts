import { ServiceUnavailableException } from '@nestjs/common';

const USER_AGENT = 'ArkiLaunch/0.1 (truck distance estimate)';
let nextRequestAt = 0;
let queue = Promise.resolve();

// One serialized Nominatim request per second across search and reverse.
export async function nominatimJson(url: URL): Promise<unknown> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + 1000;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!response?.ok) throw new ServiceUnavailableException({ error: 'geocoding_unavailable' });
    return response.json();
  } finally {
    release();
  }
}
