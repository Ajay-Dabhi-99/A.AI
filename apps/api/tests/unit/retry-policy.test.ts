import { AIProviderError, type AIProviderErrorOptions } from '@a-ai/ai-core';
import { describe, expect, it } from 'vitest';
import { decideAfterFailure, DEFAULT_RETRY_POLICY, sleep } from '../../src/ai/retry-policy.js';

const providerError = (options: Omit<AIProviderErrorOptions, 'provider' | 'message'>) =>
  new AIProviderError({ provider: 'groq', message: 'failed', ...options });

const first = {
  attemptsOnModel: 1,
  maxAttempts: 2,
  producedText: false,
  policy: DEFAULT_RETRY_POLICY,
};

describe('decideAfterFailure (ADR-013 table)', () => {
  it('retries a timeout once after the backoff, then falls back', () => {
    const error = providerError({ code: 'PROVIDER_TIMEOUT' });
    expect(decideAfterFailure(error, first)).toEqual({
      retry: { delayMs: 500 },
      fallback: true,
      providerFault: true,
    });
    expect(decideAfterFailure(error, { ...first, attemptsOnModel: 2 })).toEqual({
      retry: null,
      fallback: true,
      providerFault: true,
    });
  });

  it('honours a short Retry-After, and skips the retry for a long one', () => {
    expect(
      decideAfterFailure(providerError({ code: 'RATE_LIMITED', retryAfterSeconds: 2 }), first)
        .retry,
    ).toEqual({ delayMs: 2_000 });
    expect(decideAfterFailure(providerError({ code: 'RATE_LIMITED' }), first).retry).toEqual({
      delayMs: 1_000,
    });
    expect(
      decideAfterFailure(providerError({ code: 'RATE_LIMITED', retryAfterSeconds: 30 }), first),
    ).toEqual({ retry: null, fallback: true, providerFault: true });
  });

  it('retries a transient outage but not a rejected key or unknown model', () => {
    expect(
      decideAfterFailure(providerError({ code: 'MODEL_UNAVAILABLE', retryable: true }), first)
        .retry,
    ).toEqual({ delayMs: 500 });
    expect(
      decideAfterFailure(providerError({ code: 'MODEL_UNAVAILABLE', retryable: false }), first),
    ).toEqual({ retry: null, fallback: true, providerFault: true });
  });

  it('falls back from an unreadable response without retrying it', () => {
    expect(decideAfterFailure(providerError({ code: 'PROVIDER_BAD_RESPONSE' }), first)).toEqual({
      retry: null,
      fallback: true,
      providerFault: true,
    });
  });

  it('never retries or falls back once text has streamed', () => {
    for (const code of ['PROVIDER_TIMEOUT', 'RATE_LIMITED', 'MODEL_UNAVAILABLE'] as const) {
      expect(
        decideAfterFailure(providerError({ code }), { ...first, producedText: true }),
      ).toMatchObject({ retry: null, fallback: false, providerFault: true });
    }
  });

  it('gives up on unexpected errors and on non-provider codes', () => {
    const giveUp = { retry: null, fallback: false, providerFault: false };
    expect(decideAfterFailure(new Error('socket hang up'), first)).toEqual(giveUp);
    expect(decideAfterFailure(providerError({ code: 'CONTEXT_TOO_LARGE' }), first)).toEqual(giveUp);
    expect(decideAfterFailure(new DOMException('stop', 'AbortError'), first)).toEqual(giveUp);
  });

  it('gives fallback models no retry when their limit is one attempt', () => {
    expect(
      decideAfterFailure(providerError({ code: 'PROVIDER_TIMEOUT' }), { ...first, maxAttempts: 1 })
        .retry,
    ).toBeNull();
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    await expect(sleep(5, new AbortController().signal)).resolves.toBeUndefined();
  });

  it('rejects at once when aborted, before or during the wait', async () => {
    const aborted = new AbortController();
    aborted.abort(new DOMException('stop', 'AbortError'));
    await expect(sleep(10_000, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });

    const later = new AbortController();
    const waiting = sleep(10_000, later.signal);
    later.abort(new DOMException('stop', 'AbortError'));
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
