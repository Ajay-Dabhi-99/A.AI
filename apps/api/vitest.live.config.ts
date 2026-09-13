import { defineConfig } from 'vitest/config';

/**
 * Real Supabase PostgreSQL + Upstash Redis. Requires TEST_DATABASE_URL and
 * TEST_REDIS_URL; the suite fails (never skips) when they are missing.
 */
export default defineConfig({
  resolve: { conditions: ['@a-ai/source'] },
  ssr: { resolve: { conditions: ['@a-ai/source'] } },
  test: {
    include: ['tests/live/**/*.test.ts'],
    // Applies prisma/migrations to the test database first (reproducible from clean).
    globalSetup: ['tests/live/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
