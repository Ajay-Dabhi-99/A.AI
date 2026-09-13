/**
 * Verifies the server environment without printing any values.
 * Local: reads the repository-root .env. CI/deploy: reads the real environment.
 *
 *   pnpm check:env
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  configuredProviders,
  EnvValidationError,
  parseServerEnv,
} from '../packages/config/src/server.js';

const envFile = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

try {
  const env = parseServerEnv(process.env);
  const providers = configuredProviders(env);
  console.log(`Environment valid for NODE_ENV=${env.NODE_ENV}.`);
  console.log(
    `DIRECT_URL: ${env.DIRECT_URL ? 'set' : 'not set (migrations will use DATABASE_URL)'}`,
  );
  console.log(`AI providers configured: ${providers.length ? providers.join(', ') : 'none'}`);
  if (providers.length === 0) {
    console.error('Warning: no AI provider key is set, so GET /ready will report not_ready.');
    process.exitCode = 1;
  }
} catch (error) {
  if (!(error instanceof EnvValidationError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
