import { describe, expect, it } from 'vitest';
import { AIProviderError, ProviderRegistry, type AIProvider } from '../src/index.js';

function fakeProvider(id: string): AIProvider {
  return {
    id,
    chat: async (request) => ({
      provider: id,
      model: request.model,
      text: 'ok',
      usage: { source: 'estimated' },
      finishReason: 'stop',
    }),
    async *stream() {
      yield { type: 'delta', text: 'ok' };
      yield { type: 'done', finishReason: 'stop' };
    },
    getModels: async () => [],
  };
}

describe('ProviderRegistry', () => {
  it('registers and returns providers by id', () => {
    const registry = new ProviderRegistry()
      .register(fakeProvider('alpha'))
      .register(fakeProvider('beta'));
    expect(registry.has('alpha')).toBe(true);
    expect(registry.get('beta').id).toBe('beta');
    expect(registry.list().map((provider) => provider.id)).toEqual(['alpha', 'beta']);
  });

  it('rejects duplicate and blank ids', () => {
    const registry = new ProviderRegistry().register(fakeProvider('alpha'));
    expect(() => registry.register(fakeProvider('alpha'))).toThrow(/already registered/);
    expect(() => registry.register(fakeProvider('  '))).toThrow(/non-empty/);
  });

  it('reports an unknown provider as a non-retryable MODEL_UNAVAILABLE error', () => {
    const registry = new ProviderRegistry();
    try {
      registry.get('missing');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AIProviderError);
      expect(error).toMatchObject({
        code: 'MODEL_UNAVAILABLE',
        retryable: false,
        provider: 'missing',
      });
    }
  });
});

describe('AIProviderError', () => {
  it('uses the taxonomy default when retryable is not given', () => {
    expect(
      new AIProviderError({ provider: 'p', code: 'RATE_LIMITED', message: 'slow down' }).retryable,
    ).toBe(true);
    expect(
      new AIProviderError({ provider: 'p', code: 'PROVIDER_BAD_RESPONSE', message: 'bad' })
        .retryable,
    ).toBe(false);
  });
});
