import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@arkilaunch/db';

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

// ACA Jobs run under the direct/superuser connection (same one
// packages/db/src/migrate.ts uses), the closest this dev setup has to
// service_role: cron writes need to reach platform-wide tables like
// diesel_price_readings that app_authenticated only has SELECT on (0002
// migration), while every tenant-owned row a job touches must still carry
// an explicit tenant_id (RFC-2 §8 "service_role scoping discipline" --
// bypassing RLS is not license to skip tenant scoping).
export function makeJobDb() {
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error('DATABASE_URL_DIRECT is required for jobs');
  const client = postgres(connectionString, { max: 1 });
  return { db: drizzle(client, { schema }), client };
}
