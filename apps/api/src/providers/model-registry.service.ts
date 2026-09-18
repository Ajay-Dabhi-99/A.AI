import type { AIProvider, ProviderRegistry } from '@a-ai/ai-core';
import type {
  AIModel,
  AIModelAvailability,
  AIModelCategory,
  CatalogModel,
  ModelStatus,
  ProviderInfo,
} from '@a-ai/shared-types';
import type { ModelUpdateRequest } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import type {
  ModelRegistryDefault,
  ModelRegistryPatch,
  ModelRegistryRecord,
  ModelRegistryRepository,
} from '../repositories/model-registry.repository.js';
import type { Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors/app-error.js';

export const REGISTRY_CACHE_TTL_MS = 30_000;

export type ModelRegistryServiceDeps = {
  repository: ModelRegistryRepository;
  adapters: ProviderRegistry;
  defaults: readonly ModelRegistryDefault[];
  providerNames: Readonly<Record<string, string>>;
  clock: Clock;
  logger: FastifyBaseLogger;
  cacheTtlMs?: number;
  /** The model new chats start with, when it is available. Omitted: the first available one. */
  preferredDefault?: { provider: string; id: string };
};

function toAIModel(row: ModelRegistryRecord): AIModel {
  return {
    id: row.modelId,
    provider: row.provider,
    name: row.name,
    category: row.category as AIModelCategory,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    supportsStreaming: row.supportsStreaming,
    supportsVision: row.supportsVision,
    supportsTools: row.supportsTools,
    availability: row.availability as AIModelAvailability,
    inputPricePerMillionUsd: row.inputPricePerMillionUsd,
    outputPricePerMillionUsd: row.outputPricePerMillionUsd,
  };
}

/**
 * The single source of truth for which models exist and whether each can be
 * used (blueprint §7 "model registry"). Rows live in PostgreSQL so admins can
 * change them without a deploy; status combines the row with the adapters
 * configured in this process. Rows are cached briefly; an update clears the
 * cache here, and other API instances pick it up within the TTL.
 */
export class ModelRegistryService {
  readonly #deps: ModelRegistryServiceDeps;
  readonly #ttlMs: number;
  #cache: { rows: ModelRegistryRecord[]; expiresAt: number } | null = null;
  #defaultsInserted: Promise<void> | null = null;

  constructor(deps: ModelRegistryServiceDeps) {
    this.#deps = deps;
    this.#ttlMs = deps.cacheTtlMs ?? REGISTRY_CACHE_TTL_MS;
  }

  /** Every registry entry with its status (public catalog and admin view). */
  async catalog(): Promise<CatalogModel[]> {
    return (await this.#rows()).map((row) => this.#toCatalogModel(row));
  }

  /** Models that can be used right now, in display order. */
  async available(): Promise<AIModel[]> {
    return (await this.#rows()).filter((row) => this.#status(row) === 'available').map(toAIModel);
  }

  /**
   * The model a new chat starts with: the preferred default while it can be
   * used, and otherwise the first model in display order. Null when no model is
   * available at all, which is what a deployment with no provider key looks like.
   */
  async defaultModel(): Promise<AIModel | null> {
    const available = await this.available();
    const preferred = this.#deps.preferredDefault;
    const match = preferred
      ? available.find(
          (model) => model.provider === preferred.provider && model.id === preferred.id,
        )
      : undefined;
    return match ?? available[0] ?? null;
  }

  async providers(): Promise<ProviderInfo[]> {
    const ids = new Set((await this.#rows()).map((row) => row.provider));
    for (const adapter of this.#deps.adapters.list()) ids.add(adapter.id);
    return [...ids].map((id) => ({
      id,
      name: this.#deps.providerNames[id] ?? id,
      configured: this.#deps.adapters.has(id),
    }));
  }

  /** @throws AppError MODEL_UNAVAILABLE (400) unless the model is available right now. */
  async resolve(
    providerId: string,
    modelId: string,
  ): Promise<{ provider: AIProvider; model: AIModel }> {
    const row = (await this.#rows()).find(
      (candidate) => candidate.provider === providerId && candidate.modelId === modelId,
    );
    if (!row || this.#status(row) !== 'available') {
      throw new AppError(
        'MODEL_UNAVAILABLE',
        'This model is not available. Choose another model.',
        {
          statusCode: 400,
          retryable: false,
        },
      );
    }
    return { provider: this.#deps.adapters.get(providerId), model: toAIModel(row) };
  }

  /** @throws AppError NOT_FOUND when the entry does not exist. */
  async update(registryId: string, changes: ModelUpdateRequest): Promise<CatalogModel> {
    const { verified, ...fields } = changes;
    const patch: ModelRegistryPatch = { ...fields };
    if (verified !== undefined) patch.verifiedAt = verified ? this.#deps.clock.now() : null;

    const current = (await this.#rows()).find((row) => row.id === registryId);
    if (!current) throw new AppError('NOT_FOUND', 'This model does not exist.');
    const nextContext = patch.contextWindow ?? current.contextWindow;
    const nextOutput = patch.maxOutputTokens ?? current.maxOutputTokens;
    if (nextOutput >= nextContext) {
      throw new AppError(
        'VALIDATION_ERROR',
        'The output limit must be smaller than the context window.',
        {
          details: [
            { path: 'maxOutputTokens', message: 'Must be smaller than the context window' },
          ],
        },
      );
    }

    const updated = await this.#deps.repository.update(registryId, patch);
    this.invalidate();
    if (!updated) throw new AppError('NOT_FOUND', 'This model does not exist.');
    return this.#toCatalogModel(updated);
  }

  invalidate(): void {
    this.#cache = null;
  }

  async #rows(): Promise<ModelRegistryRecord[]> {
    const now = this.#deps.clock.now().getTime();
    if (this.#cache && this.#cache.expiresAt > now) return this.#cache.rows;

    await this.#ensureDefaults();
    const rows = await this.#deps.repository.list();
    this.#cache = { rows, expiresAt: now + this.#ttlMs };
    return rows;
  }

  /** Once per process: a fresh database gets the catalog defaults automatically. */
  #ensureDefaults(): Promise<void> {
    this.#defaultsInserted ??= this.#deps.repository
      .insertMissing(this.#deps.defaults)
      .then((inserted) => {
        if (inserted > 0) this.#deps.logger.info({ inserted }, 'model registry defaults inserted');
      })
      .catch((error: unknown) => {
        this.#defaultsInserted = null;
        throw error;
      });
    return this.#defaultsInserted;
  }

  #status(row: ModelRegistryRecord): ModelStatus {
    if (!row.enabled) return 'disabled';
    return this.#deps.adapters.has(row.provider) ? 'available' : 'provider_not_configured';
  }

  #toCatalogModel(row: ModelRegistryRecord): CatalogModel {
    return {
      ...toAIModel(row),
      registryId: row.id,
      status: this.#status(row),
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
