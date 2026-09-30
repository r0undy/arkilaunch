import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

// Pooled connection as app_authenticated (non-BYPASSRLS); service_role is never used on a request path.
const connectionString = process.env.DATABASE_URL_POOLED;
if (!connectionString) {
  throw new Error('DATABASE_URL_POOLED is required');
}

// prepare: false: Supavisor transaction mode has no server-side prepared statements. Explicit
// timeouts make a pooler auth hiccup a query error, not an uncaught rejection that crashes.
const queryClient = postgres(connectionString, {
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
});
export const db = drizzle(queryClient, { schema });
export type Db = typeof db;
