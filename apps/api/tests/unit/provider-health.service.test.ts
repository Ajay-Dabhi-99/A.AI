import { AIProviderError, type AIProviderErrorOptions } from '@a-ai/ai-core';
import { describe, expect, it } from 'vitest';
import {
  CIRCUIT_COOLDOWN_MS,
  ProviderHealthService,
} from '../../src/providers/provider-health.service.js';
import { createRedisStore } from '../../src/services/kv-store.js';
import { TestClock } from '../helpers/fakes.js';
import { controlledRedis } from '../helpers/test-app.js';

const failure = (options: Partial<AIProviderErrorOptions> = {}) =>
  new AIProviderError({
    provider: 'groq',
    code: 'PROVIDER_TIMEOUT',
    message: 'slow',
    ...options,
  });

const providers = [
  { id: 'groq', name: 'Groq', configured: true },
  { id: 'gemini', name: 'Gemini', configured: false },
];

function setup() {
  const clock = new TestClock('2026-09-15T12:00:00.000Z');
  const health = new ProviderHealthService({ store: createRedisStore(controlledRedis()), clock });
  return { clock, health };
}

describe('ProviderHealthService', () => {
  it('reports healthy, degraded and not configured providers', async () => {
    const { health } = setup();
    expect((await health.snapshot(providers)).map((item) => item.status)).toEqual([
      'healthy',
      'not_configured',
    ]);

    await health.recordFailure('groq', failure({ code: 'MODEL_UNAVAILABLE' }));
    const [groq] = await health.snapshot(providers);
    expect(groq).toMatchObject({
      status: 'degraded',
      consecutiveFailures: 1,
      lastErrorCode: 'MODEL_UNAVAILABLE',
      retryAt: null,
      lastFailureAt: '2026-09-15T12:00:00.000Z',
    });
    expect(await health.isDown('groq')).toBe(false);
  });

  it('opens the circuit after three consecutive failures, for the cooldown', async () => {
    const { clock, health } = setup();
    for (let index = 0; index < 3; index++) await health.recordFailure('groq', failure());

    expect(await health.isDown('groq')).toBe(true);
    const [groq] = await health.snapshot(providers);
    expect(groq).toMatchObject({
      status: 'down',
      retryAt: new Date(Date.parse('2026-09-15T12:00:00.000Z') + CIRCUIT_COOLDOWN_MS).toISOString(),
    });
    expect(await health.downProviders(['groq', 'gemini', 'groq'])).toEqual(new Set(['groq']));

    clock.advance(CIRCUIT_COOLDOWN_MS + 1);
    expect(await health.isDown('groq')).toBe(false);
    // The probe after the cooldown fails: straight back to down.
    await health.recordFailure('groq', failure());
    expect(await health.isDown('groq')).toBe(true);
  });

  it('opens at once for a rate limit with Retry-After, capped at a minute', async () => {
    const { clock, health } = setup();
    await health.recordFailure('groq', failure({ code: 'RATE_LIMITED', retryAfterSeconds: 20 }));
    expect(await health.isDown('groq')).toBe(true);
    clock.advance(20_001);
    expect(await health.isDown('groq')).toBe(false);

    await health.recordFailure('groq', failure({ code: 'RATE_LIMITED', retryAfterSeconds: 3_600 }));
    clock.advance(60_001);
    expect(await health.isDown('groq')).toBe(false);
  });

  it('closes the circuit and clears failures on success', async () => {
    const { health } = setup();
    for (let index = 0; index < 3; index++) await health.recordFailure('groq', failure());
    await health.recordSuccess('groq');

    const [groq] = await health.snapshot(providers);
    expect(groq).toMatchObject({
      status: 'healthy',
      consecutiveFailures: 0,
      retryAt: null,
      lastErrorCode: 'PROVIDER_TIMEOUT',
      lastSuccessAt: '2026-09-15T12:00:00.000Z',
    });
  });
});
