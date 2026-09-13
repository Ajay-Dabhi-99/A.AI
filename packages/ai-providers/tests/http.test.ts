import { AIProviderError } from '@a-ai/ai-core';
import { describe, expect, it } from 'vitest';
import { classifyHttpStatus, parseRetryAfter, providerFetch } from '../src/index.js';

describe('classifyHttpStatus', () => {
  it.each([
    [408, 'PROVIDER_TIMEOUT', true],
    [504, 'PROVIDER_TIMEOUT', true],
    [429, 'RATE_LIMITED', true],
    [401, 'MODEL_UNAVAILABLE', false],
    [403, 'MODEL_UNAVAILABLE', false],
    [404, 'MODEL_UNAVAILABLE', false],
    [500, 'MODEL_UNAVAILABLE', true],
    [503, 'MODEL_UNAVAILABLE', true],
    [400, 'PROVIDER_BAD_RESPONSE', false],
    [422, 'PROVIDER_BAD_RESPONSE', false],
  ] as const)('maps %i to %s (retryable=%s)', (status, code, retryable) => {
    expect(classifyHttpStatus(status)).toEqual({ code, retryable });
  });
});

describe('parseRetryAfter', () => {
  it('parses delta seconds and HTTP dates', () => {
    const now = Date.parse('2026-09-13T10:00:00Z');
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter('Sun, 13 Sep 2026 10:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('providerFetch', () => {
  it('returns the response for 2xx', async () => {
    const response = await providerFetch({
      provider: 'test',
      url: 'https://example.test',
      timeoutMs: 1000,
      fetchImpl: async () => new Response('ok', { status: 200 }),
    });
    expect(await response.text()).toBe('ok');
  });

  it('throws a classified error with Retry-After for non-2xx, without leaking the body', async () => {
    const error = await providerFetch({
      provider: 'test',
      url: 'https://example.test',
      timeoutMs: 1000,
      fetchImpl: async () =>
        new Response('{"error":"key sk-secret invalid"}', {
          status: 429,
          headers: { 'retry-after': '12' },
        }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AIProviderError);
    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      status: 429,
      retryAfterSeconds: 12,
    });
    expect((error as Error).message).not.toContain('sk-secret');
  });

  it('turns an elapsed timeout into PROVIDER_TIMEOUT', async () => {
    const error = await providerFetch({
      provider: 'slow',
      url: 'https://example.test',
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true, provider: 'slow' });
  });

  it('rethrows caller cancellation instead of reporting a provider failure', async () => {
    const controller = new AbortController();
    const pending = providerFetch({
      provider: 'test',
      url: 'https://example.test',
      timeoutMs: 5000,
      signal: controller.signal,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    controller.abort(new DOMException('client left', 'AbortError'));

    const error = await pending.catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(AIProviderError);
    expect(error).toMatchObject({ name: 'AbortError', message: 'client left' });
  });

  it('turns network failures into retryable MODEL_UNAVAILABLE', async () => {
    const error = await providerFetch({
      provider: 'down',
      url: 'https://example.test',
      timeoutMs: 1000,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'MODEL_UNAVAILABLE', retryable: true });
  });
});
