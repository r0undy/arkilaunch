import { sql } from 'drizzle-orm';
import { db } from './client.js';
import { manilaDate, round2HalfUp } from '@arkilaunch/shared';

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

// Via the SECURITY DEFINER function: app_authenticated holds no INSERT on this global table
// every quote freezes. Authorization is still the route's diesel:manage check.
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

// Retired DOE path, kept: the stale-reading test (QAD-T45) needs a per-region write.
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

// Average of every station inside the price_sane band. The payload is untrusted: only numbers are read.
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
  return round2HalfUp(prices.reduce((sum, p) => sum + p, 0) / prices.length);
}

// Throws when the fetch fails or nothing parses, so the caller keeps the last-known reading.
export async function recordGasWatchDieselReading(region = 'NCR'): Promise<DieselManualReadingRow> {
  const response = await fetch(GASWATCH_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GasWatch returned ${response.status}`);
  const price = averageGasWatchDiesel(await response.json());
  if (price === null) throw new Error('GasWatch returned no usable diesel price');
  const rows = await db.execute<DieselManualReadingRow>(sql`
    select * from diesel_record_gaswatch_reading(
      ${region},
      ${String(price)}::numeric,
      ${manilaDate(new Date())}::date,
      ${GASWATCH_URL}
    )
  `);
  const row = rows[0];
  if (!row) throw new Error('diesel_record_gaswatch_reading returned no row');
  return row;
}
