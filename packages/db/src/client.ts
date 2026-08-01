import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

// The pooled Supavisor connection. This is the app_authenticated,
// non-BYPASSRLS role — service_role is never used on a request path
// (AGENTS.md "Never"; RFC-1 §3).
const connectionString = process.env.DATABASE_URL_POOLED;
if (!connectionString) {
  throw new Error('DATABASE_URL_POOLED is required');
}

// prepare: false because Supavisor's transaction-mode pooler does not
// support server-side prepared statements. connect_timeout/idle_timeout
// are set explicitly so a transient pooler-side auth hiccup on an idle
// connection surfaces as a query error on the next request (which NestJS's
// exception filter turns into a 500), not an uncaught rejection that
// crashes the process.
const queryClient = postgres(connectionString, {
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
});
export const db = drizzle(queryClient, { schema });
export type Db = typeof db;
