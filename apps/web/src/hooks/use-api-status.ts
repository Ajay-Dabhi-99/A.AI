import type { ReadinessResponse } from '@a-ai/shared-types';
import { useQuery } from '@tanstack/react-query';
import { fetchReadiness } from '@/services/api';

export type ApiStatus = 'checking' | 'operational' | 'degraded' | 'offline';

export type ApiStatusResult = {
  status: ApiStatus;
  report: ReadinessResponse | undefined;
};

/** Server truth for platform health, refreshed every 30 seconds. */
export function useApiStatus(): ApiStatusResult {
  const query = useQuery({
    queryKey: ['api', 'readiness'],
    queryFn: ({ signal }) => fetchReadiness(signal),
    refetchInterval: 30_000,
    retry: false,
  });

  if (query.isPending) return { status: 'checking', report: undefined };
  if (query.isError) return { status: 'offline', report: undefined };
  return { status: query.data.status === 'ready' ? 'operational' : 'degraded', report: query.data };
}
