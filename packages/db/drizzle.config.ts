import { defineConfig } from 'drizzle-kit';

// Direct URL, not the pooler: migrations need a direct connection.
export default defineConfig({
  schema: './src/schema/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? '',
  },
});
