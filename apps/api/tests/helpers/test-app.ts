import { parseServerEnv, type ServerEnv } from '@a-ai/config/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { ServiceOverrides } from '../../src/services/container.js';
import { CapturingEmailSender, TestClock } from './fakes.js';
import { createMemoryRepositories, type MemoryRepositories } from './memory-repositories.js';

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

let isolatedRedisPort = 40_000;

/**
 * In-process Redis implementation of the ioredis API (blueprint v4 "controlled
 * Redis test adapter"). ioredis-mock shares one data set between instances with
 * the same host and port, so each call gets its own port: rate-limit and quota
 * counters must never leak from one test into the next.
 */
export function controlledRedis(): Redis {
  isolatedRedisPort += 1;
  return new RedisMock({ port: isolatedRedisPort }) as unknown as Redis;
}

export async function buildTestApp(
  options: {
    env?: ServerEnv;
    prisma?: PrismaClient;
    redis?: Redis;
    services?: ServiceOverrides;
  } = {},
): Promise<FastifyInstance> {
  const repositories = createMemoryRepositories();
  return buildApp({
    env: options.env ?? testEnv(),
    prisma: options.prisma ?? controlledPrisma(),
    redis: options.redis ?? controlledRedis(),
    services: {
      repositories,
      transaction: repositories.transaction,
      email: new CapturingEmailSender(),
      ...options.services,
    },
    logger: false,
  });
}

export type AuthTestContext = {
  app: FastifyInstance;
  repositories: MemoryRepositories;
  emails: CapturingEmailSender;
  clock: TestClock;
};

/** A full app with in-memory accounts, captured emails and a controllable clock. */
export async function buildAuthTestApp(
  options: { env?: ServerEnv; services?: ServiceOverrides } = {},
): Promise<AuthTestContext> {
  const repositories = createMemoryRepositories();
  const emails = new CapturingEmailSender();
  const clock = new TestClock();
  const app = await buildApp({
    env: options.env ?? testEnv(),
    prisma: controlledPrisma(),
    redis: controlledRedis(),
    services: {
      repositories,
      transaction: repositories.transaction,
      email: emails,
      clock,
      ...options.services,
    },
    logger: false,
  });
  return { app, repositories, emails, clock };
}

export function cookieValue(response: LightMyRequestResponse, name: string): string | undefined {
  return response.cookies.find((cookie) => cookie.name === name)?.value;
}

export function setCookieFor(response: LightMyRequestResponse, name: string) {
  return response.cookies.find((cookie) => cookie.name === name);
}
