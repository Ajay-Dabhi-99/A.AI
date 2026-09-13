import { apiErrorBodySchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors/app-error.js';
import { buildTestApp, WEB_ORIGIN } from '../helpers/test-app.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('request correlation', () => {
  it('generates an x-request-id and echoes it in error bodies', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    const requestId = response.headers['x-request-id'];

    expect(requestId).toEqual(expect.any(String));
    expect(response.json().error.requestId).toBe(requestId);
  });

  it('preserves a safe inbound x-request-id', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-12345678' },
    });
    expect(response.headers['x-request-id']).toBe('trace-12345678');
  });
});

describe('error envelope', () => {
  it('returns NOT_FOUND for unknown routes', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/unknown?x=secret' });

    expect(response.statusCode).toBe(404);
    const body = apiErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).not.toContain('secret');
  });

  it('forwards AppError from a route and hides unexpected errors', async () => {
    app = await buildTestApp();
    app.get('/test/app-error', async () => {
      throw new AppError('AUTH_REQUIRED', 'Please sign in to view history.');
    });
    app.get('/test/crash', async () => {
      throw new Error('ECONNREFUSED postgres://admin:pw@10.0.0.5');
    });

    const appError = await app.inject({ method: 'GET', url: '/test/app-error' });
    expect(appError.statusCode).toBe(401);
    expect(appError.json().error).toMatchObject({
      code: 'AUTH_REQUIRED',
      message: 'Please sign in to view history.',
    });

    const crash = await app.inject({ method: 'GET', url: '/test/crash' });
    expect(crash.statusCode).toBe(500);
    expect(apiErrorBodySchema.parse(crash.json()).error.code).toBe('INTERNAL_ERROR');
    expect(crash.body).not.toContain('postgres://');
    expect(crash.body).not.toContain('stack');
  });

  it('rejects malformed JSON and schema violations with VALIDATION_ERROR', async () => {
    app = await buildTestApp();
    app.post(
      '/test/echo',
      {
        schema: {
          body: {
            type: 'object',
            required: ['prompt'],
            properties: { prompt: { type: 'string', minLength: 1 } },
          },
        },
      },
      async (request) => request.body,
    );

    const malformed = await app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"prompt":',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('VALIDATION_ERROR');

    const invalid = await app.inject({
      method: 'POST',
      url: '/test/echo',
      payload: { prompt: '' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'prompt' }],
    });
  });

  it('rejects bodies above the size limit', async () => {
    app = await buildTestApp();
    app.post('/test/echo', async () => ({ ok: true }));
    const response = await app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ prompt: 'x'.repeat(1_100_000) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('browser security', () => {
  it('allows the configured origin with credentials', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/ready',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'GET' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant CORS to other origins', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets security headers', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
