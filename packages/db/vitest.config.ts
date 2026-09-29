import { defineConfig } from 'vitest/config';

// Integration tests need a real Postgres via DATABASE_URL_*; the GUC-leak test needs the real pooler.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
