import { describe, expect, it } from 'vitest';
import { modelUpdateRequestSchema } from '../src/index.js';

describe('modelUpdateRequestSchema', () => {
  it('accepts a partial update and null prices', () => {
    expect(
      modelUpdateRequestSchema.parse({ enabled: false, inputPricePerMillionUsd: null }),
    ).toEqual({ enabled: false, inputPricePerMillionUsd: null });
  });

  it('requires at least one change', () => {
    expect(modelUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown fields, so ids and providers cannot be rewritten', () => {
    expect(modelUpdateRequestSchema.safeParse({ provider: 'evil', enabled: true }).success).toBe(
      false,
    );
    expect(modelUpdateRequestSchema.safeParse({ modelId: 'x' }).success).toBe(false);
  });

  it('validates bounds and the output limit against the context window', () => {
    expect(modelUpdateRequestSchema.safeParse({ inputPricePerMillionUsd: -1 }).success).toBe(false);
    expect(modelUpdateRequestSchema.safeParse({ contextWindow: 10 }).success).toBe(false);
    const inverted = modelUpdateRequestSchema.safeParse({
      contextWindow: 8_000,
      maxOutputTokens: 8_000,
    });
    expect(inverted.success).toBe(false);
    expect(inverted.error?.issues[0]?.path).toEqual(['maxOutputTokens']);
  });
});
