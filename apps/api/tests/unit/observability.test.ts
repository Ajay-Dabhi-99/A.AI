import { describe, expect, it } from 'vitest';
import { resolveRequestId } from '../../src/plugins/observability.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a safe upstream correlation id', () => {
    expect(resolveRequestId('vercel:bom1::abc123-1726212345')).toBe(
      'vercel:bom1::abc123-1726212345',
    );
  });

  it('uses the first value when the header repeats', () => {
    expect(resolveRequestId(['first-request-id', 'second-request-id'])).toBe('first-request-id');
  });

  it.each([
    ['missing', undefined],
    ['too short', 'abc'],
    ['log injection', 'abcdefgh\n{"level":60}'],
    ['too long', 'a'.repeat(129)],
  ])('generates a UUID when the header is %s', (_label, header) => {
    expect(resolveRequestId(header)).toMatch(UUID);
  });
});
