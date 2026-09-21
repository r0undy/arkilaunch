import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // The engine specs share one seeded database, one bookable unit and
    // one tenant-wide checkout rate limit. In parallel they clean up each
    // other's rows and trip each other's 429s; run files one at a time.
    fileParallelism: false,
  },
});
