import type { ProviderHealthResponse } from '@a-ai/shared-types';
import { providerHealthResponseSchema } from '@a-ai/validation';
import { apiRequest } from './api';

/** GET /api/providers/health: circuit-breaker status per provider (Phase 6). */
export const fetchProviderHealth = (signal?: AbortSignal): Promise<ProviderHealthResponse> =>
  apiRequest('/api/providers/health', {
    schema: providerHealthResponseSchema,
    ...(signal ? { signal } : {}),
  });
