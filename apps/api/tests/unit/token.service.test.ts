import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_MIN_CHARACTERS,
  effectiveCharsPerToken,
  nextCalibration,
  TokenService,
} from '../../src/ai/token.service.js';
import { createRedisStore } from '../../src/services/kv-store.js';
import { controlledRedis } from '../helpers/test-app.js';

const model = { provider: 'groq', id: 'openai/gpt-oss-20b' };

function setup() {
  const store = createRedisStore(controlledRedis());
  return { store, tokens: new TokenService(store) };
}

describe('TokenService', () => {
  it('uses 4 characters per token until a model has been observed three times', async () => {
    const { tokens } = setup();
    expect(await tokens.charsPerToken(model)).toBe(4);

    await tokens.record(model, 900, 450);
    await tokens.record(model, 900, 450);
    expect(await tokens.charsPerToken(model)).toBe(4);

    await tokens.record(model, 900, 450);
    expect(await tokens.charsPerToken(model)).toBe(2);
  });

  it('keeps calibration separate per model', async () => {
    const { tokens } = setup();
    for (let index = 0; index < 3; index++) await tokens.record(model, 1_200, 400);
    expect(await tokens.charsPerToken(model)).toBe(3);
    expect(await tokens.charsPerToken({ provider: 'gemini', id: 'gemini-3.8-flash' })).toBe(4);
  });

  it('ignores short prompts and missing counts', async () => {
    const { tokens } = setup();
    for (let index = 0; index < 5; index++) {
      await tokens.record(model, CALIBRATION_MIN_CHARACTERS - 1, 10);
      await tokens.record(model, 5_000, 0);
    }
    expect(await tokens.charsPerToken(model)).toBe(4);
  });

  it('ignores a corrupt stored value', async () => {
    const { store, tokens } = setup();
    await store.setJson(`tokens:ratio:${model.provider}:${model.id}`, { ratio: 'x' }, 60_000);
    expect(await tokens.charsPerToken(model)).toBe(4);
  });
});

describe('calibration math', () => {
  it('moves a fifth of the way towards each new observation', () => {
    expect(nextCalibration(null, 3.2)).toEqual({ ratio: 3.2, samples: 1 });
    const next = nextCalibration({ ratio: 4, samples: 3 }, 2);
    expect(next.samples).toBe(4);
    expect(next.ratio).toBeCloseTo(3.6);
  });

  it('only ever makes estimates more cautious, within 2 to 4 characters per token', () => {
    expect(effectiveCharsPerToken({ ratio: 1.1, samples: 10 })).toBe(2);
    expect(effectiveCharsPerToken({ ratio: 3.3, samples: 10 })).toBe(3.3);
    expect(effectiveCharsPerToken({ ratio: 6, samples: 10 })).toBe(4);
    expect(effectiveCharsPerToken({ ratio: Number.NaN, samples: 10 })).toBe(4);
  });
});
