import { defineConfig } from 'drizzle-kit';

// DATABASE_URL_DIRECT (port 5432), not the pooled Supavisor URL: migrations
// need a direct connection (BUILD §3 "Fast-moving deps that require live
// verification"; Supavisor + `set_config(local=true)` behavior).
export default defineConfig({
  schema: './src/schema/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? '',
  },
});
