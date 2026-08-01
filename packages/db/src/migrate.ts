import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

// Direct connection (not pooled) for DDL, per BUILD §3.
const connectionString = process.env.DATABASE_URL_DIRECT;
if (!connectionString) {
  throw new Error('DATABASE_URL_DIRECT is required');
}

const migrationClient = postgres(connectionString, { max: 1 });
const db = drizzle(migrationClient);

await migrate(db, { migrationsFolder: './migrations' });

// CREATE ROLE app_authenticated in 0000_create_app_role.sql sets no
// password (a committed SQL file is not where a secret belongs). Set/rotate
// it here from APP_AUTHENTICATED_PASSWORD so DATABASE_URL_POOLED can
// authenticate as the actual non-BYPASSRLS role -- the `postgres` role is a
// superuser and superusers bypass RLS regardless of FORCE (AGENTS.md
// "Never": service_role, and by the same logic any superuser, on a
// request path).
const appAuthenticatedPassword = process.env.APP_AUTHENTICATED_PASSWORD;
if (appAuthenticatedPassword) {
  await migrationClient.unsafe(
    `ALTER ROLE app_authenticated WITH PASSWORD '${appAuthenticatedPassword.replace(/'/g, "''")}'`,
  );
  console.log('app_authenticated password set from APP_AUTHENTICATED_PASSWORD.');
} else {
  console.warn(
    'APP_AUTHENTICATED_PASSWORD not set -- app_authenticated has no password and cannot log in yet.',
  );
}

await migrationClient.end();

console.log('Migrations applied.');
