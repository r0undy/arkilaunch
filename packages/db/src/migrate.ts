import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const connectionString = process.env.DATABASE_URL_DIRECT;
if (!connectionString) {
  throw new Error('DATABASE_URL_DIRECT is required');
}

const migrationClient = postgres(connectionString, { max: 1 });
const db = drizzle(migrationClient);

await migrate(db, { migrationsFolder: './migrations' });

// The committed SQL creates app_authenticated with no password; set it here so the pooled URL
// authenticates as the non-BYPASSRLS role (postgres is a superuser and bypasses RLS).
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
