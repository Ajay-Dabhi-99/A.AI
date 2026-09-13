import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@a-ai/source'] },
  ssr: { resolve: { conditions: ['@a-ai/source'] } },
  test: { include: ['tests/**/*.test.ts'] },
});
