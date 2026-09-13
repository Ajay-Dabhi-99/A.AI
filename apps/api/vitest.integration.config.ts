import { defineConfig } from 'vitest/config';

/** Fastify routes exercised end-to-end through `inject` with controlled DB/Redis adapters. */
export default defineConfig({
  resolve: { conditions: ['@a-ai/source'] },
  ssr: { resolve: { conditions: ['@a-ai/source'] } },
  test: { include: ['tests/integration/**/*.test.ts'] },
});
