import { ProviderRegistry, type AIProvider } from '@a-ai/ai-core';
import {
  createProvider,
  DEFAULT_MODEL,
  MODEL_CATALOG,
  PROVIDER_LABELS,
  type ProviderKey,
} from '@a-ai/ai-providers';
import { PROVIDER_KEY_VARIABLES, type ServerEnv } from '@a-ai/config/server';
import type { AIModel } from '@a-ai/shared-types';
import type { ModelRegistryDefault } from '../repositories/model-registry.repository.js';

export type ProviderEntry = {
  provider: AIProvider;
  models: readonly AIModel[];
};

/**
 * The order models are listed in, and seeded into the registry with. It no
 * longer decides which model is the default (`DEFAULT_MODEL` names that), but it
 * does decide what the picker shows first and, through registry order, which
 * model a failed run falls back to (ADR-013).
 */
export const PROVIDER_PREFERENCE: readonly ProviderKey[] = ['gemini', 'groq', 'openrouter'];

/** Adapters for every provider whose API key is configured. Missing keys mean absent, never faked. */
export function providerEntriesFromEnv(env: ServerEnv): ProviderEntry[] {
  return PROVIDER_PREFERENCE.flatMap((key) => {
    const apiKey = env[PROVIDER_KEY_VARIABLES[key]];
    return apiKey ? [{ provider: createProvider(key, apiKey), models: MODEL_CATALOG[key] }] : [];
  });
}

export function createAdapterRegistry(entries: readonly ProviderEntry[]): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const entry of entries) registry.register(entry.provider);
  return registry;
}

export const DEFAULT_PROVIDER_NAMES: Readonly<Record<string, string>> = PROVIDER_LABELS;

/** The model new chats start with while it is available (catalog `DEFAULT_MODEL`). */
export const PREFERRED_DEFAULT_MODEL: { provider: string; id: string } = DEFAULT_MODEL;

/**
 * Registry rows seeded from the code catalog, in provider preference order.
 * Rows are inserted once and never overwritten, so changing that order only
 * affects a fresh database; existing ones are reordered by a migration.
 * verifiedAt is always null: only an admin who confirmed the limits with a real
 * key sets it.
 */
export function registryDefaults(models: readonly AIModel[]): ModelRegistryDefault[] {
  return models.map((model, index) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name,
    category: model.category,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    supportsStreaming: model.supportsStreaming,
    supportsVision: model.supportsVision,
    supportsTools: model.supportsTools,
    availability: model.availability,
    enabled: true,
    sortOrder: (index + 1) * 10,
    inputPricePerMillionUsd: model.inputPricePerMillionUsd,
    outputPricePerMillionUsd: model.outputPricePerMillionUsd,
    verifiedAt: null,
  }));
}

/** Every catalog model, for every provider, in preference order. */
export function catalogModels(): AIModel[] {
  return PROVIDER_PREFERENCE.flatMap((key) => [...MODEL_CATALOG[key]]);
}
