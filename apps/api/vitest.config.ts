import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // The engine specs run against a remote Postgres; a full booking journey
    // is dozens of round trips, which 30s did not always cover.
    testTimeout: 90000,
    hookTimeout: 30000,
    // One shared seeded DB, bookable unit and checkout rate limit: in parallel, files clobber each other.
    fileParallelism: false,
  },
});
