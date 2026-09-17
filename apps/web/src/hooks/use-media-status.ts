import type { MediaJobKind } from '@a-ai/shared-types';
import { useQuery } from '@tanstack/react-query';
import { fetchMediaStatus } from '@/services/jobs';

/** Whether image or video generation is enabled, and with which models. Shared cache. */
export function useMediaStatus(kind: MediaJobKind) {
  return useQuery({
    queryKey: ['media-status', kind],
    queryFn: ({ signal }) => fetchMediaStatus(kind, signal),
    staleTime: 60_000,
  });
}
