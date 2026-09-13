import { parseServerEnv, type ServerEnv } from '@a-ai/config/server';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

export const WEB_ORIGIN = 'http://localhost:5180';

export function testEnv(overrides: Record<string, string | undefined> = {}): ServerEnv {
  return parseServerEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@db.invalid:5432/a_ai',
    REDIS_URL: 'rediss://default:test@redis.invalid:6379',
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    CORS_ORIGIN: WEB_ORIGIN,
    GROQ_API_KEY: 'test-groq-key',
    ...overrides,
  });
}

type ControlledPrisma = Pick<PrismaClient, '$queryRaw' | '$disconnect'>;

/** A database adapter whose SELECT 1 behaves however the test needs. */
export function controlledPrisma(
  probe: () => Promise<unknown> = async () => [{ '?column?': 1 }],
): PrismaClient {
  const client: ControlledPrisma = {
    $queryRaw: (() => probe()) as unknown as PrismaClient['$queryRaw'],
    $disconnect: async () => undefined,
  };
  return client as PrismaClient;
}

/** In-process Redis implementation of the ioredis API (blueprint v4 "controlled Redis test adapter"). */
export function controlledRedis(): Redis {
  return new RedisMock() as unknown as Redis;
}

export async function buildTestApp(
  options: { env?: ServerEnv; prisma?: PrismaClient; redis?: Redis } = {},
): Promise<FastifyInstance> {
  return buildApp({
    env: options.env ?? testEnv(),
    prisma: options.prisma ?? controlledPrisma(),
    redis: options.redis ?? controlledRedis(),
    logger: false,
  });
}
