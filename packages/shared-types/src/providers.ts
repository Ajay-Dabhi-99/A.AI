import type { ErrorCode } from './errors.js';

/** Provider health contracts (Phase 6, docs/api/models.md, ADR-013). */

/**
 * - healthy: no recent provider failures
 * - degraded: failing, but still tried
 * - down: circuit open; skipped for fallback until `retryAt`
 * - not_configured: this deployment has no key for the provider
 */
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down' | 'not_configured';

export type ProviderHealth = {
  id: string;
  name: string;
  configured: boolean;
  status: ProviderHealthStatus;
  consecutiveFailures: number;
  lastErrorCode: ErrorCode | null;
  /** When a provider that is down will be tried again; null otherwise. */
  retryAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};

/** GET /api/providers/health */
export type ProviderHealthResponse = {
  providers: ProviderHealth[];
};
