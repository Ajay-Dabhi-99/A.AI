import type { AudioStatus } from '@a-ai/shared-types';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchAudioStatus } from '@/services/audio';

/** Whether voice input is available on this deployment (Phase 9). */
export function useAudioStatus(): UseQueryResult<AudioStatus> {
  return useQuery({
    queryKey: ['audio-status'],
    queryFn: ({ signal }) => fetchAudioStatus(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
