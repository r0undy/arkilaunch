import { dieselPriceReadings, events } from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runInstrumentedJob } from './telemetry.js';

// RFC-3 §3/§6/§8 (QUOTE-04): daily ACA Job cron. Fetches the DOE public
// oil-price-watch page, parses the diesel figure defensively, bound-checks
// it, and writes a new diesel_price_readings row. The quote path never
// calls DOE directly -- it only ever reads the last row this job writes.
//
// Gated by ENABLE_DIESEL_SCRAPE (default false): the CLR legal-review note
// on robots.txt/RA 10175 (RFC-3 §6) has not cleared yet, so this ships
// built but off. Manual entry (a platform-admin route) and the tenant
// diesel override on pricing_parameters keep the quote engine fully
// functional with the flag off.
const DOE_HOST_ALLOWLIST = new Set(['www.doe.gov.ph']);
const DEFAULT_DOE_URL = 'https://www.doe.gov.ph/oil-monitor';
const PRICE_SANE_MIN = 20;
const PRICE_SANE_MAX = 150;
const REGION = 'NCR'; // Almara (Quezon City) = NCR, RFC-3 §3

function assertAllowlistedHost(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !DOE_HOST_ALLOWLIST.has(parsed.hostname)) {
    throw new Error(`refusing to fetch a non-allowlisted host: ${parsed.hostname}`);
  }
}

// Defensive: the DOE page has no API contract and can change layout without
// notice (RFC-3 §8). Treat the fetched HTML as untrusted data -- extract a
// number, never eval/exec it, never render it. Verify this selector/regex
// against the live page before ever enabling ENABLE_DIESEL_SCRAPE.
function parseDieselPricePhp(html: string): number | null {
  const match = html.match(/diesel[^0-9]{0,60}(\d{1,3}\.\d{1,4})/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export async function runDieselRefresh(): Promise<void> {
  if (process.env.ENABLE_DIESEL_SCRAPE !== 'true') {
    console.log('diesel-refresh: ENABLE_DIESEL_SCRAPE is off; skipping (RFC-3 CLR legal review pending).');
    return;
  }

  const url = process.env.DOE_PRICE_WATCH_URL ?? DEFAULT_DOE_URL;
  const { db, client } = makeJobDb();

  try {
    assertAllowlistedHost(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`DOE fetch returned ${response.status}`);
    const html = await response.text();

    const price = parseDieselPricePhp(html);
    const outOfBand = price !== null && (price < PRICE_SANE_MIN || price > PRICE_SANE_MAX);

    if (price === null || outOfBand) {
      await db.insert(events).values({
        name: 'external_dependency_degraded',
        properties: {
          dependency: 'doe_diesel',
          mode: 'fallback',
          reason: price === null ? 'parse_failed' : 'out_of_band_value',
        },
      });
      console.warn(
        `diesel-refresh: ${price === null ? 'parse failed' : `out-of-band value ${price}`}; leaving last-known reading in place.`,
      );
      return;
    }

    await db.insert(dieselPriceReadings).values({
      region: REGION,
      pricePhp: String(price),
      observedDate: new Date().toISOString().slice(0, 10),
      source: 'doe_scrape',
      sourceUrl: url,
    });
    console.log(`diesel-refresh: wrote a new ${REGION} reading of ${price} PHP/L from ${url}.`);
  } catch (err) {
    await db.insert(events).values({
      name: 'external_dependency_degraded',
      properties: { dependency: 'doe_diesel', mode: 'down', error: err instanceof Error ? err.message : String(err) },
    });
    console.error('diesel-refresh: fetch/parse failed, leaving last-known reading in place.', err);
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  runInstrumentedJob('diesel', () => runDieselRefresh()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
