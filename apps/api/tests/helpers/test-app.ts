import { parseServerEnv, type ServerEnv } from '@a-ai/config/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { ServiceOverrides } from '../../src/services/container.js';
import type { AIModel } from '@a-ai/shared-types';
import { CapturingEmailSender, TestClock } from './fakes.js';
import { createMemoryComparisons, type MemoryComparisons } from './memory-comparisons.js';
import { createMemoryConversations, type MemoryConversations } from './memory-conversations.js';
import { createMemoryHistory } from './memory-history.js';
import { createMemoryModelRegistry } from './memory-model-registry.js';
import { ScriptedProvider, testModel } from './scripted-provider.js';
import { createMemoryRepositories, type MemoryRepositories } from './memory-repositories.js';

export const WEB_ORIGIN = 'http://localhost:5180';

/** Real retry rules with millisecond delays, so failure tests do not wait for real backoff. */
export const FAST_RETRY = { backoffMs: 1, rateLimitDelayMs: 1 } as const;

/**
 * Memory conversations and comparisons (the caller's, when it passes its own)
 * and a history repository reading exactly those, as the SQL one reads the tables.
 */
function memoryStores(services: ServiceOverrides | undefined) {
  const conversations = (services?.conversations ??
    createMemoryConversations()) as MemoryConversations;
  const comparisons = (services?.comparisons ?? createMemoryComparisons()) as MemoryComparisons;
  return { conversations, comparisons, history: createMemoryHistory(conversations, comparisons) };
}

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
      ...memoryStores(options.services),
      modelRegistry: createMemoryModelRegistry(),
      email: new CapturingEmailSender(),
      retryPolicy: FAST_RETRY,
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
      ...memoryStores(options.services),
      modelRegistry: createMemoryModelRegistry(),
      email: emails,
      clock,
      retryPolicy: FAST_RETRY,
      ...options.services,
    },
    logger: false,
  });
  return { app, repositories, emails, clock };
}

export type ChatTestContext = AuthTestContext & {
  provider: ScriptedProvider;
  model: AIModel;
  conversations: MemoryConversations;
};

/** An auth test app whose only model is backed by a scripted provider. */
export async function buildChatTestApp(
  options: { env?: ServerEnv; model?: Partial<AIModel>; services?: ServiceOverrides } = {},
): Promise<ChatTestContext> {
  const provider = new ScriptedProvider('scripted');
  const model = testModel('scripted', 'fast-1', options.model);
  const conversations = createMemoryConversations();
  const context = await buildAuthTestApp({
    ...(options.env ? { env: options.env } : {}),
    services: { providers: [{ provider, models: [model] }], conversations, ...options.services },
  });
  return { ...context, provider, model, conversations };
}

export type CompareTestContext = AuthTestContext & {
  alpha: ScriptedProvider;
  beta: ScriptedProvider;
  gamma: ScriptedProvider;
  comparisons: MemoryComparisons;
};

/** An auth test app with three scripted providers (models a-1, b-1, g-1) for comparisons. */
export async function buildCompareTestApp(
  options: { env?: ServerEnv; services?: ServiceOverrides } = {},
): Promise<CompareTestContext> {
  const alpha = new ScriptedProvider('alpha');
  const beta = new ScriptedProvider('beta');
  const gamma = new ScriptedProvider('gamma');
  const comparisons = createMemoryComparisons();
  const context = await buildAuthTestApp({
    ...(options.env ? { env: options.env } : {}),
    services: {
      providers: [
        { provider: alpha, models: [testModel('alpha', 'a-1')] },
        { provider: beta, models: [testModel('beta', 'b-1')] },
        { provider: gamma, models: [testModel('gamma', 'g-1')] },
      ],
      comparisons,
      ...options.services,
    },
  });
  return { ...context, alpha, beta, gamma, comparisons };
}

export function cookieValue(response: LightMyRequestResponse, name: string): string | undefined {
  return response.cookies.find((cookie) => cookie.name === name)?.value;
}

export function setCookieFor(response: LightMyRequestResponse, name: string) {
  return response.cookies.find((cookie) => cookie.name === name);
}
