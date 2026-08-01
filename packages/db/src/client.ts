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

const queryClient = postgres(connectionString, { prepare: false });
export const db = drizzle(queryClient, { schema });
export type Db = typeof db;
