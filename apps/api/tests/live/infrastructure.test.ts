import { randomUUID } from 'node:crypto';
import { readinessResponseSchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/plugins/prisma.js';
import { createRedisClient } from '../../src/plugins/redis.js';
import { testEnv } from '../helpers/test-app.js';

/**
 * Phase 0 infrastructure gate against real Supabase PostgreSQL and Upstash
 * Redis. Missing credentials fail the suite: a skipped gate is not a pass.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

if (!databaseUrl || !redisUrl) {
  throw new Error(
    'Live infrastructure tests need TEST_DATABASE_URL (Supabase) and TEST_REDIS_URL (Upstash). ' +
      'Set them in the root .env or CI secrets.',
  );
}

const env = testEnv({ DATABASE_URL: databaseUrl, REDIS_URL: redisUrl });
let prisma: PrismaClient;
let redis: Redis;
let app: FastifyInstance;

beforeAll(async () => {
  const silent = { warn: () => undefined } as unknown as FastifyInstance['log'];
  prisma = createPrismaClient(env);
  redis = createRedisClient(env, silent);
  app = await buildApp({ env, prisma, redis, logger: false });
});

afterAll(async () => {
  await app?.close();
});

describe('Supabase PostgreSQL', () => {
  it('answers a query through Prisma and the pg adapter', async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1::int AS ok`;
    expect(rows).toEqual([{ ok: 1 }]);
  });
});

describe('Upstash Redis', () => {
  it('stores a value with a TTL and expires it', async () => {
    const key = `test:phase0:${randomUUID()}`;
    await redis.set(key, 'alive', 'PX', 1500);

    expect(await redis.get(key)).toBe('alive');
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1500);

    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(await redis.get(key)).toBeNull();
  });

  it('keeps atomic counters consistent (the primitive quotas and rate limits use)', async () => {
    const key = `test:phase0:counter:${randomUUID()}`;
    await Promise.all(Array.from({ length: 25 }, () => redis.incr(key)));
    expect(await redis.get(key)).toBe('25');
    await redis.del(key);
  });
});

describe('GET /ready against real infrastructure', () => {
  it('reports ready', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    const report = readinessResponseSchema.parse(response.json());
    expect(report.checks.database.status).toBe('up');
    expect(report.checks.redis.status).toBe('up');
    expect(response.statusCode).toBe(200);
  });
});
