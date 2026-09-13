import { configuredProviders, type ServerEnv } from '@a-ai/config/server';
import type { DependencyCheck, ReadinessResponse } from '@a-ai/shared-types';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { READINESS_PROBE_TIMEOUT_MS } from '../../shared/constants/app.js';

class ProbeTimeoutError extends Error {}

/**
 * Runs one dependency probe with a hard timeout. The client only ever sees a
 * generic reason; the underlying error is logged server-side by name/code.
 */
export async function probeDependency(
  name: string,
  probe: () => Promise<unknown>,
  logger: FastifyBaseLogger,
  timeoutMs: number = READINESS_PROBE_TIMEOUT_MS,
): Promise<DependencyCheck> {
  const startedAt = performance.now();
  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      probe(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeoutError()), timeoutMs);
      }),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    const timedOut = error instanceof ProbeTimeoutError;
    const detail = error as { name?: string; code?: string };
    logger.warn(
      { dependency: name, timedOut, errorName: detail?.name, errorCode: detail?.code },
      'readiness probe failed',
    );
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - startedAt),
      error: timedOut ? `timed out after ${timeoutMs}ms` : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkReadiness(
  app: FastifyInstance,
  env: ServerEnv,
  logger: FastifyBaseLogger,
): Promise<ReadinessResponse> {
  const [database, redis] = await Promise.all([
    probeDependency('database', () => app.prisma.$queryRaw`SELECT 1`, logger),
    probeDependency(
      'redis',
      async () => {
        const reply = await app.redis.ping();
        if (reply !== 'PONG') throw new Error('unexpected PING reply');
      },
      logger,
    ),
  ]);

  const configured = configuredProviders(env);
  const providers = { status: configured.length > 0 ? 'up' : 'down', configured } as const;
  const ready = database.status === 'up' && redis.status === 'up' && providers.status === 'up';

  return { status: ready ? 'ready' : 'not_ready', checks: { database, redis, providers } };
}
