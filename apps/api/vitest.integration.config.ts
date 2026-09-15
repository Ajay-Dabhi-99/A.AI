import { defineConfig } from 'vitest/config';

/** Fastify routes exercised end-to-end through `inject` with controlled DB/Redis adapters. */
export default defineConfig({
  resolve: { conditions: ['@a-ai/source'] },
  ssr: { resolve: { conditions: ['@a-ai/source'] } },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    // Files run in parallel and hash real passwords; cold starts can exceed the 5 s default.
    testTimeout: 20_000,
  },
});
