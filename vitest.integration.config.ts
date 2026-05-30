import { defineConfig } from 'vitest/config';

// Integration tests hit a real Postgres (DATABASE_URL must point at a throwaway
// database). They share one connection and reset the schema between tests, so
// they must not run in parallel.
export default defineConfig({
  test: {
    include: ['backend/src/**/*.integration.test.ts'],
    setupFiles: ['backend/src/test/integrationSetup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
