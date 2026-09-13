import type { ServerEnv } from '@a-ai/config/server';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

/**
 * Upstash Redis over TLS (rediss://). Mandatory for the MVP: guest sessions,
 * quotas, rate limits and temporary context all go through this client.
 * Connection loss is logged and retried with capped backoff; /ready reports it.
 */
export function createRedisClient(env: ServerEnv, logger: FastifyBaseLogger): Redis {
  const client = new Redis(env.REDIS_URL, {
    connectTimeout: 5_000,
    maxRetriesPerRequest: 2,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
  });

  let lastErrorLoggedAt = 0;
  client.on('error', (error: Error & { code?: string }) => {
    // Reconnect loops emit an error per attempt; log at most every 30s.
    const now = Date.now();
    if (now - lastErrorLoggedAt < 30_000) return;
    lastErrorLoggedAt = now;
    logger.warn({ errorCode: error.code, errorName: error.name }, 'redis connection error');
  });

  return client;
}

export function registerRedis(app: FastifyInstance, client: Redis): void {
  app.decorate('redis', client);
  app.addHook('onClose', async () => {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  });
}
