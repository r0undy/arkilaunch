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

// DOE scrape cron (jobs/src/diesel.ts). Same reason as the manual entry
// above: the cron runs on the pooled app_authenticated client, not as
// service_role, so it lost its direct INSERT with migration 0020 and goes
// through its own SECURITY DEFINER function, which hard-codes
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
