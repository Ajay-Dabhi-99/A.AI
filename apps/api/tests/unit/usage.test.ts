import { describe, expect, it } from 'vitest';
import { normalizeUsage } from '../../src/ai/usage.js';

const estimate = { inputTokens: 100, outputTokens: 40 };

describe('normalizeUsage', () => {
  it('keeps complete provider counts and adds the total', () => {
    expect(
      normalizeUsage({ source: 'provider', inputTokens: 90, outputTokens: 30 }, estimate),
    ).toEqual({ source: 'provider', inputTokens: 90, outputTokens: 30, totalTokens: 120 });
  });

  it('keeps a provider total that includes extra tokens, but never one below the sum', () => {
    expect(
      normalizeUsage(
        { source: 'provider', inputTokens: 90, outputTokens: 30, totalTokens: 150 },
        estimate,
      ).totalTokens,
    ).toBe(150);
    expect(
      normalizeUsage(
        { source: 'provider', inputTokens: 90, outputTokens: 30, totalTokens: 10 },
        estimate,
      ).totalTokens,
    ).toBe(120);
  });

  it('labels partial provider counts as estimated and fills the gap', () => {
    expect(normalizeUsage({ source: 'provider', inputTokens: 90 }, estimate)).toEqual({
      source: 'estimated',
      inputTokens: 90,
      outputTokens: 40,
      totalTokens: 130,
    });
  });

  it('uses the estimate when the provider reported nothing usable', () => {
    const expected = { source: 'estimated', inputTokens: 100, outputTokens: 40, totalTokens: 140 };
    expect(normalizeUsage(null, estimate)).toEqual(expected);
    expect(
      normalizeUsage({ source: 'provider', inputTokens: -1, outputTokens: 2.5 }, estimate),
    ).toEqual(expected);
    // Counts an adapter itself estimated are not treated as exact.
    expect(
      normalizeUsage({ source: 'estimated', inputTokens: 1, outputTokens: 1 }, estimate),
    ).toMatchObject({ source: 'estimated', inputTokens: 100 });
  });
});
