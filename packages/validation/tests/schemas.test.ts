import { describe, expect, it } from 'vitest';
import { apiErrorBodySchema, readinessResponseSchema } from '../src/index.js';

describe('apiErrorBodySchema', () => {
  it('accepts the canonical error envelope', () => {
    const body = {
      error: { code: 'RATE_LIMITED', message: 'Slow down', retryable: true, requestId: 'req-1' },
    };
    expect(apiErrorBodySchema.parse(body)).toEqual(body);
  });

  it('rejects codes outside the taxonomy', () => {
    const result = apiErrorBodySchema.safeParse({
      error: { code: 'TEAPOT', message: 'x', retryable: false, requestId: 'r' },
    });
    expect(result.success).toBe(false);
  });
});

describe('readinessResponseSchema', () => {
  const up = { status: 'up', latencyMs: 3 };

  it('accepts a full readiness report', () => {
    const report = {
      status: 'ready',
      checks: { database: up, redis: up, providers: { status: 'up', configured: ['groq'] } },
    };
    expect(readinessResponseSchema.parse(report)).toEqual(report);
  });

  it('requires the database, redis and provider checks', () => {
    expect(
      readinessResponseSchema.safeParse({ status: 'ready', checks: { database: up, redis: up } })
        .success,
    ).toBe(false);
  });
});
