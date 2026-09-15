import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { runSmoke, waitForCommit } from '../../src/ops/smoke.js';
import type { ErrorContext, ErrorReporter } from '../../src/plugins/error-reporting.js';
import { buildTestApp, controlledPrisma, testEnv, WEB_ORIGIN } from '../helpers/test-app.js';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function track(app: Promise<FastifyInstance>): Promise<FastifyInstance> {
  const built = await app;
  apps.push(built);
  return built;
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

describe('client address behind proxies (security review S-1)', () => {
  const echoIp = (app: FastifyInstance) => {
    app.get('/__ip', async (request) => ({ ip: request.ip }));
    return app;
  };
  const forwarded = {
    remoteAddress: '10.0.0.1',
    headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' },
  };

  it('trusts exactly the configured number of proxy hops', async () => {
    const app = echoIp(await track(buildTestApp({ env: testEnv({ TRUST_PROXY_HOPS: '1' }) })));
    const response = await app.inject({ method: 'GET', url: '/__ip', ...forwarded });
    // The entry added by the one trusted proxy, never one the client wrote itself.
    expect(response.json()).toEqual({ ip: '198.51.100.7' });
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    const app = echoIp(await track(buildTestApp({ env: testEnv({ TRUST_PROXY_HOPS: '0' }) })));
    const response = await app.inject({ method: 'GET', url: '/__ip', ...forwarded });
    expect(response.json()).toEqual({ ip: '10.0.0.1' });
  });
});

describe('error reporting', () => {
  it('reports unexpected errors with identifiers only, and never expected rejections', async () => {
    const captured: { error: unknown; context: ErrorContext | undefined }[] = [];
    const errorReporter: ErrorReporter = {
      enabled: true,
      capture: (error, context) => captured.push({ error, context }),
      flush: async () => undefined,
    };
    const app = await track(buildTestApp({ errorReporter }));
    app.get('/__boom', async () => {
      throw new Error('database password is hunter2');
    });

    const boom = await app.inject({ method: 'GET', url: '/__boom' });
    expect(boom.statusCode).toBe(500);
    expect(boom.body).not.toContain('hunter2');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.context).toEqual({
      requestId: boom.headers['x-request-id'],
      method: 'GET',
      route: '/__boom',
    });

    await app.inject({ method: 'POST', url: '/api/chat', payload: {} });
    await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(captured).toHaveLength(1);
  });
});

describe('release smoke test (Phase 10 gate)', () => {
  it('passes against a healthy API without calling any provider', async () => {
    const app = await track(
      buildTestApp({ env: testEnv({ RENDER_GIT_COMMIT: 'abc1234def5678' }) }),
    );
    const apiUrl = await listen(app);

    const results = await runSmoke({
      apiUrl,
      webOrigin: WEB_ORIGIN,
      checkWeb: false,
      expectCommit: 'abc1234def5678',
    });
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results.map((result) => result.name)).toEqual([
      'health',
      'readiness',
      'security headers',
      'error envelope',
      'validation before providers',
      'CORS allows the web app',
      'CORS refuses other sites',
      'guest session cookie',
      'models',
      'capabilities',
    ]);
    expect(await waitForCommit({ apiUrl, commit: 'abc1234def5678', timeoutMs: 1_000 })).toBe(true);
  });

  it('names what is broken', async () => {
    const app = await track(
      buildTestApp({
        env: testEnv({
          RENDER_GIT_COMMIT: 'abc1234def5678',
          CORS_ORIGIN: 'https://other.example.com',
        }),
        prisma: controlledPrisma(() => Promise.reject(new Error('connection refused'))),
      }),
    );
    const apiUrl = await listen(app);

    const results = await runSmoke({
      apiUrl,
      webOrigin: WEB_ORIGIN,
      checkWeb: false,
      expectCommit: 'fedcba9',
    });
    const failed = Object.fromEntries(
      results.filter((result) => !result.ok).map((result) => [result.name, result.detail]),
    );
    expect(Object.keys(failed).sort()).toEqual(['CORS allows the web app', 'health', 'readiness']);
    expect(failed.health).toContain('expected fedcba9');
    expect(failed.readiness).toBe('not ready: database');
    expect(
      await waitForCommit({ apiUrl, commit: 'fedcba9', timeoutMs: 300, intervalMs: 100 }),
    ).toBe(false);
  });
});
