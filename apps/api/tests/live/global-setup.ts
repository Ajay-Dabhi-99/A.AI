import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Applies every Prisma migration to the test Supabase database before the live
 * suite runs, which also proves the migrations reproduce from a clean database.
 * Skipped silently when credentials are missing: the suites themselves fail loudly.
 */
export default function setup(): void {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) return;

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: resolve(import.meta.dirname, '../../../..'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_URL: process.env.TEST_DIRECT_URL || databaseUrl,
    },
  });
}
