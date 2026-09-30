import { events, recordGasWatchDieselReading } from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runJobIfMain } from './telemetry.js';

const REGION = 'NCR'; // the one region quotes price in today (RFC-3 §3)

export async function runDieselRefresh(): Promise<void> {
  if (process.env.ENABLE_DIESEL_SCRAPE !== 'true') {
    console.log('diesel-refresh: ENABLE_DIESEL_SCRAPE is off; skipping.');
    return;
  }

  const { db, client } = makeJobDb();
  try {
    const reading = await recordGasWatchDieselReading(REGION);
    console.log(`diesel-refresh: wrote a new ${REGION} reading of ${reading.price_php} PHP/L from GasWatch.`);
  } catch (err) {
    await db.insert(events).values({
      name: 'external_dependency_degraded',
      properties: { dependency: 'gaswatch_diesel', mode: 'down', error: err instanceof Error ? err.message : String(err) },
    });
    console.error('diesel-refresh: GasWatch fetch failed, leaving last-known reading in place.', err);
  } finally {
    await client.end();
  }
}

runJobIfMain(import.meta.url, 'diesel', runDieselRefresh);
