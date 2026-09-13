import { AIProviderError } from '@a-ai/ai-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/shared/errors/app-error.js';
import { toApiError } from '../../src/shared/errors/to-api-error.js';

describe('toApiError', () => {
  it('forwards AppError code, status, message and details', () => {
    const result = toApiError(
      new AppError('QUOTA_EXCEEDED', 'Daily guest limit reached.', {
        details: [{ path: 'x', message: 'y' }],
      }),
      'req-1',
    );
    expect(result).toEqual({
      statusCode: 429,
      headers: {},
      unexpected: false,
      body: {
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'Daily guest limit reached.',
          retryable: false,
          requestId: 'req-1',
          details: [{ path: 'x', message: 'y' }],
        },
      },
    });
  });

  it('maps provider errors to their gateway status and passes Retry-After through', () => {
    const result = toApiError(
      new AIProviderError({
        provider: 'groq',
        code: 'RATE_LIMITED',
        message: 'groq returned HTTP 429',
        retryAfterSeconds: 9,
      }),
      'req-2',
    );
    expect(result.statusCode).toBe(429);
    expect(result.headers).toEqual({ 'retry-after': '9' });
    expect(result.body.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });

    expect(
      toApiError(
        new AIProviderError({ provider: 'p', code: 'PROVIDER_TIMEOUT', message: 't' }),
        'r',
      ).statusCode,
    ).toBe(504);
  });

  it('turns Zod failures into VALIDATION_ERROR with field paths', () => {
    const parsed = z.object({ prompt: z.string().min(1) }).safeParse({ prompt: '' });
    if (parsed.success) throw new Error('expected failure');
    const result = toApiError(parsed.error, 'req-3');
    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(result.body.error.details?.[0]?.path).toBe('prompt');
  });

  it('maps Fastify schema validation errors', () => {
    const error = Object.assign(new Error('body/prompt must be string'), {
      statusCode: 400,
      validation: [{ instancePath: '/messages/0/content', message: 'must be string' }],
    });
    expect(toApiError(error, 'r').body.error.details).toEqual([
      { path: 'messages.0.content', message: 'must be string' },
    ]);
  });

  it('keeps Fastify 4xx semantics (bad JSON, payload too large)', () => {
    const tooLarge = Object.assign(new Error('Request body is too large'), { statusCode: 413 });
    expect(toApiError(tooLarge, 'r')).toMatchObject({
      statusCode: 413,
      body: { error: { code: 'VALIDATION_ERROR' } },
    });
  });

  it('never leaks the message of an unexpected error', () => {
    const result = toApiError(new Error('connect to postgresql://user:pw@host failed'), 'req-4');
    expect(result.statusCode).toBe(500);
    expect(result.unexpected).toBe(true);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result.body)).not.toContain('postgresql://');
  });
});
