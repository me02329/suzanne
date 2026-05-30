import { defineConfig, configDefaults } from 'vitest/config';

// Default test run = unit tests only. Integration tests (which need a live
// Postgres) are excluded here and run via vitest.integration.config.ts so that
// `npm test` and the default CI job stay database-free.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
  },
});
