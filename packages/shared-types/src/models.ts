import type { AIModel } from './ai.js';

/** Model registry contracts (Phase 3, docs/api/models.md). */

/**
 * - available: enabled and its provider key is configured
 * - disabled: turned off by an admin
 * - provider_not_configured: enabled, but this deployment has no key for the provider
 */
export type ModelStatus = 'available' | 'disabled' | 'provider_not_configured';

/** Display information for a provider, so clients never hard-code provider names. */
export type ProviderInfo = {
  id: string;
  name: string;
  configured: boolean;
};

export type CatalogModel = AIModel & {
  registryId: string;
  status: ModelStatus;
  enabled: boolean;
  sortOrder: number;
  /** When an admin confirmed the limits with a real key; null means unverified. */
  verifiedAt: string | null;
  updatedAt: string;
};

/** GET /api/models/catalog (everyone) and GET /api/admin/models (admins). */
export type ModelCatalogResponse = {
  models: CatalogModel[];
  providers: ProviderInfo[];
};

/** PATCH /api/admin/models/:registryId */
export type ModelUpdateResponse = {
  model: CatalogModel;
};
