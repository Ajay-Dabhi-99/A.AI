import { AIProviderError } from './errors.js';
import type { AIProvider } from './provider.js';

/**
 * Holds the provider adapters enabled for this process. Adapters are only
 * registered when their credentials are configured, so `get` failing means
 * "not available here", which is reported as MODEL_UNAVAILABLE.
 */
export class ProviderRegistry {
  readonly #providers = new Map<string, AIProvider>();

  register(provider: AIProvider): this {
    if (!provider.id.trim()) {
      throw new Error('Provider id must be a non-empty string');
    }
    if (this.#providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered`);
    }
    this.#providers.set(provider.id, provider);
    return this;
  }

  has(id: string): boolean {
    return this.#providers.has(id);
  }

  get(id: string): AIProvider {
    const provider = this.#providers.get(id);
    if (!provider) {
      throw new AIProviderError({
        provider: id,
        code: 'MODEL_UNAVAILABLE',
        message: `Provider "${id}" is not available`,
        retryable: false,
      });
    }
    return provider;
  }

  list(): AIProvider[] {
    return [...this.#providers.values()];
  }
}
