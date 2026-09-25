import { sql } from 'drizzle-orm';
import { db } from './client.js';

export interface DieselManualReadingInput {
  region: string;
  pricePhp: string;
  observedDate: string;
  sourceUrl: string | null;
  capturedBy: string;
}

export interface DieselManualReadingRow extends Record<string, unknown> {
  id: string;
  region: string;
  price_php: string;
  observed_date: string;
  source: string;
  source_url: string | null;
  captured_at: string;
  captured_by: string | null;
}

// Platform-admin manual diesel entry (RFC-3 §2/§3 QUOTE-05).
//
// Goes through the SECURITY DEFINER function rather than a direct INSERT:
// app_authenticated no longer holds INSERT on diesel_price_readings, a
// global un-RLS'd table whose value every tenant's quote formula freezes
// (audit-db-tenant-isolation.md #7, migration 0020). Authorization is
// still the app-layer diesel:manage check on the route -- this only moves
// the standing table privilege into one auditable function.
export async function recordManualDieselReading(
  input: DieselManualReadingInput,
): Promise<DieselManualReadingRow> {
  const rows = await db.execute<DieselManualReadingRow>(sql`
    select * from diesel_record_manual_reading(
      ${input.region},
      ${input.pricePhp}::numeric,
      ${input.observedDate}::date,
      ${input.sourceUrl},
      ${input.capturedBy}::uuid
    )
  `);
  const row = rows[0];
  if (!row) throw new Error('diesel_record_manual_reading returned no row');
  return row;
}

// The retired DOE scrape path (the cron now reads GasWatch, below). Kept
// because the stale-reading test (QAD-T45, quotes-engine.spec.ts) needs a
// per-region write: app_authenticated lost its direct INSERT with
// migration 0020, and this SECURITY DEFINER function hard-codes
// source='doe_scrape'.
export async function recordScrapeDieselReading(input: {
  region: string;
  pricePhp: string;
  observedDate: string;
  sourceUrl: string | null;
}): Promise<DieselManualReadingRow> {
  const rows = await db.execute<DieselManualReadingRow>(sql`
    select * from diesel_record_scrape_reading(
      ${input.region},
      ${input.pricePhp}::numeric,
      ${input.observedDate}::date,
      ${input.sourceUrl}
    )
  `);
  const row = rows[0];
  if (!row) throw new Error('diesel_record_scrape_reading returned no row');
  return row;
}

// GasWatch PH (customer feedback 3). Its public JSON is one entry per
// station: { overrides: { [stationId]: { diesel: { p: 104.78 }, ... } } }.
// The reading is the national average of every station's diesel price that
// sits inside the price_sane band, so one mistyped station cannot skew it.
// The payload is untrusted: numbers are read out, nothing else is used.
export const GASWATCH_URL = 'https://gaswatchph.com/api/prices';
const PRICE_SANE_MIN = 20;
const PRICE_SANE_MAX = 150;

export function averageGasWatchDiesel(payload: unknown): number | null {
  const overrides = (payload as { overrides?: Record<string, { diesel?: { p?: unknown } }> } | null)?.overrides;
  if (!overrides || typeof overrides !== 'object') return null;
  const prices = Object.values(overrides)
    .map((station) => Number(station?.diesel?.p))
    .filter((p) => Number.isFinite(p) && p >= PRICE_SANE_MIN && p <= PRICE_SANE_MAX);
  if (prices.length === 0) return null;
  return Math.round((prices.reduce((sum, p) => sum + p, 0) / prices.length) * 100) / 100;
}

// Fetches GasWatch and records the average as today's reading for the
// region. Throws when the fetch fails or nothing parses, so the caller
// keeps the last-known reading and reports the degradation.
export async function recordGasWatchDieselReading(region = 'NCR'): Promise<DieselManualReadingRow> {
  const response = await fetch(GASWATCH_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GasWatch returned ${response.status}`);
  const price = averageGasWatchDiesel(await response.json());
  if (price === null) throw new Error('GasWatch returned no usable diesel price');
  const rows = await db.execute<DieselManualReadingRow>(sql`
    select * from diesel_record_gaswatch_reading(
      ${region},
      ${String(price)}::numeric,
      ${new Date().toISOString().slice(0, 10)}::date,
      ${GASWATCH_URL}
    )
  `);
  const row = rows[0];
  if (!row) throw new Error('diesel_record_gaswatch_reading returned no row');
  return row;
}
