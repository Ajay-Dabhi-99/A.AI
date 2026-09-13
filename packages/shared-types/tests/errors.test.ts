import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRYABLE, ERROR_CODES } from '../src/index.js';

describe('error taxonomy', () => {
  it('contains every code from the blueprint taxonomy exactly once', () => {
    const blueprint = [
      'AUTH_REQUIRED',
      'QUOTA_EXCEEDED',
      'RATE_LIMITED',
      'MODEL_UNAVAILABLE',
      'PROVIDER_TIMEOUT',
      'PROVIDER_BAD_RESPONSE',
      'CONTEXT_TOO_LARGE',
      'VALIDATION_ERROR',
      'INTERNAL_ERROR',
    ];
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toEqual(expect.arrayContaining(blueprint));
  });

  it('defines retry guidance for every code', () => {
    expect(Object.keys(DEFAULT_RETRYABLE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('marks backoff-safe failures retryable and user-action failures not retryable', () => {
    expect(DEFAULT_RETRYABLE.RATE_LIMITED).toBe(true);
    expect(DEFAULT_RETRYABLE.PROVIDER_TIMEOUT).toBe(true);
    expect(DEFAULT_RETRYABLE.QUOTA_EXCEEDED).toBe(false);
    expect(DEFAULT_RETRYABLE.CONTEXT_TOO_LARGE).toBe(false);
    expect(DEFAULT_RETRYABLE.VALIDATION_ERROR).toBe(false);
  });
});
