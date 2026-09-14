import type { ModelsResponse } from '@a-ai/shared-types';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchModels } from '@/services/chat';

export const MODELS_QUERY_KEY = ['models'] as const;

/** Models the API can serve right now (only providers with configured keys). */
export function useModels(): UseQueryResult<ModelsResponse> {
  return useQuery({
    queryKey: MODELS_QUERY_KEY,
    queryFn: ({ signal }) => fetchModels(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
