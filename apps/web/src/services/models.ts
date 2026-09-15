import type { ModelCatalogResponse, ModelUpdateResponse } from '@a-ai/shared-types';
import {
  modelCatalogResponseSchema,
  modelUpdateResponseSchema,
  type ModelUpdateRequest,
} from '@a-ai/validation';
import { apiRequest } from './api';

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

/** Every registry entry with its status (public). */
export const fetchModelCatalog = (signal?: AbortSignal): Promise<ModelCatalogResponse> =>
  apiRequest('/api/models/catalog', { schema: modelCatalogResponseSchema, ...withSignal(signal) });

/** Same data, uncached, for administrators. */
export const fetchAdminModelCatalog = (signal?: AbortSignal): Promise<ModelCatalogResponse> =>
  apiRequest('/api/admin/models', { schema: modelCatalogResponseSchema, ...withSignal(signal) });

export const updateModel = (
  registryId: string,
  changes: ModelUpdateRequest,
): Promise<ModelUpdateResponse> =>
  apiRequest(`/api/admin/models/${encodeURIComponent(registryId)}`, {
    method: 'PATCH',
    body: changes,
    schema: modelUpdateResponseSchema,
  });
