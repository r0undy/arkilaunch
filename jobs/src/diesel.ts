import { events, recordGasWatchDieselReading } from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runInstrumentedJob } from './telemetry.js';

// Weekly ACA Job cron (customer feedback 3; was the RFC-3 QUOTE-04 DOE
// scrape). Records GasWatch PH's national average diesel price as a new
// diesel_price_readings row; the quote path only ever reads the last row.
// The admin "Fetch now" button (POST /pricing/diesel-price/fetch) runs the
// same recordGasWatchDieselReading, and the tenant diesel override on
// pricing_parameters is the edit path.
//
// ENABLE_DIESEL_SCRAPE stays the ops switch. GasWatch publishes a public
// JSON endpoint and its robots.txt allows all, unlike the DOE page the
// flag was first held off for.
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

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  runInstrumentedJob('diesel', () => runDieselRefresh()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
