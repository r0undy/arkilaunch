import { defineConfig } from 'vitest/config';

// Integration tests require DATABASE_URL_DIRECT against the real Supabase
// project (jobs connect the same way packages/db/src/migrate.ts does).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
