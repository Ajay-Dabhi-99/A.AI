import { ProviderRegistry, type AIProvider } from '@a-ai/ai-core';
import { createProvider, MODEL_CATALOG, type ProviderKey } from '@a-ai/ai-providers';
import { PROVIDER_KEY_VARIABLES, type ServerEnv } from '@a-ai/config/server';
import type { AIModel } from '@a-ai/shared-types';
import { AppError } from '../shared/errors/app-error.js';

export type ProviderEntry = {
  provider: AIProvider;
  models: readonly AIModel[];
};

/** Preferred order for the default model: fastest free tier first. */
const PROVIDER_PREFERENCE: readonly ProviderKey[] = ['groq', 'gemini', 'openrouter'];

/** Adapters for every provider whose API key is configured. Missing keys mean absent, never faked. */
export function providerEntriesFromEnv(env: ServerEnv): ProviderEntry[] {
  return PROVIDER_PREFERENCE.flatMap((key) => {
    const apiKey = env[PROVIDER_KEY_VARIABLES[key]];
    return apiKey ? [{ provider: createProvider(key, apiKey), models: MODEL_CATALOG[key] }] : [];
  });
}

/**
 * The models this API instance can serve, and the adapter behind each.
 * Routes and services ask the directory; they never construct adapters.
 */
export class ModelDirectory {
  readonly registry = new ProviderRegistry();
  readonly #models: AIModel[] = [];

  constructor(entries: ProviderEntry[]) {
    for (const entry of entries) {
      this.registry.register(entry.provider);
      this.#models.push(...entry.models);
    }
  }

  list(): AIModel[] {
    return [...this.#models];
  }

  defaultModel(): AIModel | undefined {
    return this.#models[0];
  }

  /** @throws AppError MODEL_UNAVAILABLE (400) when the model is not offered here. */
  resolve(providerId: string, modelId: string): { provider: AIProvider; model: AIModel } {
    const model = this.#models.find(
      (candidate) => candidate.provider === providerId && candidate.id === modelId,
    );
    if (!model || !this.registry.has(providerId)) {
      throw new AppError(
        'MODEL_UNAVAILABLE',
        'This model is not available. Choose another model.',
        {
          statusCode: 400,
          retryable: false,
        },
      );
    }
    return { provider: this.registry.get(providerId), model };
  }
}
