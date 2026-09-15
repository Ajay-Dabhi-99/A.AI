import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EnvValidationError, parseServerEnv, type ServerEnv } from '@a-ai/config/server';
import { buildApp } from './app.js';
import { createSentryReporter, type ErrorReporter } from './plugins/error-reporting.js';

// Local development reads the repository-root .env; hosted environments inject variables.
const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

let env: ServerEnv;
try {
  env = parseServerEnv(process.env);
} catch (error) {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`${error.message}\nSee .env.example for every variable.\n`);
    process.exit(1);
  }
  throw error;
}

// Error reports leave the server only when a DSN is configured (ADR-017).
const errorReporter: ErrorReporter | undefined = env.SENTRY_DSN
  ? await createSentryReporter({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      ...(env.RENDER_GIT_COMMIT ? { release: env.RENDER_GIT_COMMIT } : {}),
    })
  : undefined;

const app = await buildApp({ env, ...(errorReporter ? { errorReporter } : {}) });

process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled promise rejection');
  errorReporter?.capture(reason, { source: 'unhandledRejection' });
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  await app.close();
  await errorReporter?.flush(2_000);
  process.exit(0);
}

process.once('SIGINT', (signal) => void shutdown(signal));
process.once('SIGTERM', (signal) => void shutdown(signal));

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.fatal({ err: error }, 'failed to start');
  errorReporter?.capture(error, { source: 'startup' });
  await errorReporter?.flush(2_000);
  process.exit(1);
}
