import type { ServerEnv } from '@a-ai/config/server';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import type { PrismaClient } from './generated/prisma/client.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { registerCorsAndSecurity } from './plugins/cors.js';
import { genReqId, loggerOptions, registerObservability } from './plugins/observability.js';
import { createPrismaClient, registerPrisma } from './plugins/prisma.js';
import { createRedisClient, registerRedis } from './plugins/redis.js';
import { BODY_LIMIT_BYTES } from './shared/constants/app.js';

export type BuildAppOptions = {
  env: ServerEnv;
  /** Test seam: inject a controlled database client instead of connecting to Supabase. */
  prisma?: PrismaClient;
  /** Test seam: inject a controlled Redis adapter instead of connecting to Upstash. */
  redis?: Redis;
  logger?: FastifyServerOptions['logger'];
};

/**
 * Composes the API. Order matters: observability first so every later
 * failure is correlated and normalized, then security, infrastructure, routes.
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
  registerPrisma(app, options.prisma ?? createPrismaClient(env));
  registerRedis(app, options.redis ?? createRedisClient(env, app.log));

  await app.register(healthRoutes, { env });

  return app;
}
