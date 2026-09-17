import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchInstructions, updateInstructions } from '@/services/auth';

export const INSTRUCTIONS_QUERY_KEY = ['me', 'instructions'] as const;

/** The signed-in user's personal instructions (MODEL-069). */
export function useInstructions(enabled = true) {
  return useQuery({
    queryKey: INSTRUCTIONS_QUERY_KEY,
    queryFn: ({ signal }) => fetchInstructions(signal),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateInstructions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateInstructions,
    onSuccess: (response) => queryClient.setQueryData(INSTRUCTIONS_QUERY_KEY, response),
  });
}
