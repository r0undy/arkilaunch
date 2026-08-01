import { defineConfig } from 'vitest/config';

// Integration tests require DATABASE_URL_DIRECT / DATABASE_URL_POOLED
// against a real Postgres (RFC-1's Supavisor GUC-leak test specifically
// needs the real pooler, not a Docker Postgres -- see BUILD §3).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
