import { healthResponseSchema, readinessResponseSchema } from '@a-ai/validation';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, controlledPrisma, controlledRedis, testEnv } from '../helpers/test-app.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('returns liveness without touching dependencies', async () => {
    app = await buildTestApp({
      prisma: controlledPrisma(async () => {
        throw new Error('database must not be called');
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toMatchObject({
      status: 'ok',
      service: 'a-ai-api',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /ready', () => {
  it('is ready when Supabase, Redis and a provider are available', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    const report = readinessResponseSchema.parse(response.json());
    expect(report.status).toBe('ready');
    expect(report.checks.database.status).toBe('up');
    expect(report.checks.redis.status).toBe('up');
    expect(report.checks.providers).toEqual({ status: 'up', configured: ['groq'] });
  });

  it('returns 503 with a sanitized reason when the database is unreachable', async () => {
    app = await buildTestApp({
      prisma: controlledPrisma(async () => {
        throw new Error('getaddrinfo ENOTFOUND db.secret-project.supabase.co');
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    const report = readinessResponseSchema.parse(response.json());
    expect(report.status).toBe('not_ready');
    expect(report.checks.database).toMatchObject({ status: 'down', error: 'unreachable' });
    expect(report.checks.redis.status).toBe('up');
    expect(response.body).not.toContain('supabase.co');
  });

  it('returns 503 when mandatory Redis is unavailable', async () => {
    const redis = controlledRedis();
    redis.ping = (async () => {
      throw Object.assign(new Error('Connection is closed.'), { code: 'ECONNRESET' });
    }) as typeof redis.ping;
    app = await buildTestApp({ redis });
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.redis).toMatchObject({ status: 'down', error: 'unreachable' });
  });

  it('returns 503 when no AI provider is configured', async () => {
    app = await buildTestApp({ env: testEnv({ GROQ_API_KEY: undefined }) });
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.providers).toEqual({ status: 'down', configured: [] });
  });

  it('does not hang when a dependency never answers', async () => {
    app = await buildTestApp({ prisma: controlledPrisma(() => new Promise(() => undefined)) });
    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.database.error).toMatch(/^timed out/);
  }, 10_000);
});
