import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests (Phase 10, ADR-017). They run the production build with
 * every API call mocked in the browser, so no database, Redis or AI provider
 * is needed and no key is ever used.
 */
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Same-origin API calls, all intercepted by the tests.
    env: { VITE_API_URL: '', VITE_SENTRY_DSN: '' },
  },
});
