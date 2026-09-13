/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // One root .env for the whole monorepo; only VITE_* values reach the bundle.
  const envDir = fileURLToPath(new URL('../..', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:4000';

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      // Consume workspace packages from source: no pre-build step in dev or test.
      conditions: ['@a-ai/source', ...defaultClientConditions],
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5180,
      strictPort: true,
      // Same-origin in development so session cookies behave like production.
      proxy: { '/api': apiTarget, '/health': apiTarget, '/ready': apiTarget },
    },
    preview: { port: 5180, strictPort: true },
    test: {
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
