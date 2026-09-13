import type { AuthUser, MeResponse } from '@a-ai/shared-types';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { fetchMe } from '@/services/auth';

export const ME_QUERY_KEY = ['me'] as const;

/** Server truth for who is signed in and how much daily allowance is left. */
export function useMe(): UseQueryResult<MeResponse> {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function currentUser(data: MeResponse | undefined): AuthUser | null {
  return data?.identity.kind === 'user' ? data.identity.user : null;
}
