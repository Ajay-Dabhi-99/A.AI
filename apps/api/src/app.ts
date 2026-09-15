import type { ServerEnv } from '@a-ai/config/server';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import type { PrismaClient } from './generated/prisma/client.js';
import { registerOriginCheck } from './middleware/origin-check.js';
import { registerApiRateLimit } from './middleware/rate-limit.js';
import { attachmentRoutes } from './modules/attachments/attachment.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { audioRoutes } from './modules/audio/audio.routes.js';
import { JOB_RECOVERY_INTERVAL_MS } from './modules/jobs/job-center.js';
import { mediaRoutes } from './modules/jobs/media.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';
import { comparisonRoutes } from './modules/comparison/comparison.routes.js';
import { historyRoutes } from './modules/history/history.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { modelRoutes } from './modules/models/models.routes.js';
import { meRoutes } from './modules/users/me.routes.js';
import { registerCorsAndSecurity } from './plugins/cors.js';
import { genReqId, loggerOptions, registerObservability } from './plugins/observability.js';
import { createPrismaClient, registerPrisma } from './plugins/prisma.js';
import { createRedisClient, registerRedis } from './plugins/redis.js';
import { createServices, type ServiceOverrides } from './services/container.js';
import { BODY_LIMIT_BYTES } from './shared/constants/app.js';
import { cookieNames } from './shared/http/cookies.js';

export type BuildAppOptions = {
  env: ServerEnv;
  /** Test seam: inject a controlled database client instead of connecting to Supabase. */
  prisma?: PrismaClient;
  /** Test seam: inject a controlled Redis adapter instead of connecting to Upstash. */
  redis?: Redis;
  /** Test seam: replace repositories, email delivery, hashing, time or rate limits. */
  services?: ServiceOverrides;
  logger?: FastifyServerOptions['logger'];
};

/**
 * Composes the API. Order matters: observability first so every later
 * failure is correlated and normalized, then security, infrastructure,
 * services, request guards, routes.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { env } = options;

  const app = Fastify({
    logger: options.logger ?? loggerOptions(env),
    genReqId,
    requestIdHeader: false,
    // Fastify's per-request logs are replaced by one structured line in observability.ts.
    logController: new LogController({
      requestIdLogLabel: 'requestId',
      disableRequestLogging: true,
    }),
    bodyLimit: BODY_LIMIT_BYTES,
    // Render/Vercel terminate TLS in front of the API.
    trustProxy: env.NODE_ENV === 'production',
  });

  registerObservability(app);
  await registerCorsAndSecurity(app, env);
  await app.register(cookie);

  const prisma = options.prisma ?? createPrismaClient(env);
  const redis = options.redis ?? createRedisClient(env, app.log);
  registerPrisma(app, prisma);
  registerRedis(app, redis);

  app.decorate('env', env);
  app.decorate('cookieNames', cookieNames(env));
  app.decorate(
    'services',
    createServices({ env, prisma, redis, logger: app.log, overrides: options.services }),
  );

  registerOriginCheck(app, env);
  registerApiRateLimit(app);
  // Background summaries are bounded by their own timeout; let them finish before shutdown.
  // Jobs a stopped instance left behind are failed or started again (ADR-016), at startup and
  // periodically. Never awaited: a slow database must not delay readiness.
  let recovery: NodeJS.Timeout | undefined;
  const recoverJobs = () =>
    app.services.jobs.recover().catch((error: unknown) => {
      app.log.error({ err: error, event: 'media.job.recover.failed' }, 'job recovery failed');
    });
  app.addHook('onReady', async () => {
    void recoverJobs();
    recovery = setInterval(() => void recoverJobs(), JOB_RECOVERY_INTERVAL_MS);
    recovery.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(recovery);
    await Promise.all([app.services.context.idle(), app.services.jobs.idle()]);
  });

  // Multipart is parsed only by routes that ask for it (uploads, recordings); each sets its own limits.
  await app.register(multipart, {
    limits: { fileSize: env.ATTACHMENT_MAX_BYTES, files: 1, fields: 0, parts: 1, headerPairs: 50 },
  });

  await app.register(healthRoutes, { env });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(meRoutes);
  await app.register(chatRoutes);
  await app.register(comparisonRoutes);
  await app.register(historyRoutes);
  await app.register(modelRoutes);
  await app.register(attachmentRoutes);
  await app.register(mediaRoutes);
  await app.register(audioRoutes);

  return app;
}
