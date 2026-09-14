import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ME_QUERY_KEY } from '@/hooks/use-me';
import * as authApi from '@/services/auth';
import { migrateGuestConversation } from '@/services/chat';

/**
 * After signing in, a guest's temporary chat moves into the account
 * (idempotent on the server). A failed move never blocks the sign-in.
 */
async function afterSignIn(queryClient: QueryClient): Promise<void> {
  await migrateGuestConversation().catch(() => undefined);
  queryClient.removeQueries({ queryKey: ['guest-conversation'] });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  ]);
}

function useSignInMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => afterSignIn(queryClient) });
}

/** Signing out: drop everything cached for the previous identity. */
function useSignOutMutation(mutationFn: () => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['conversations'] });
      queryClient.removeQueries({ queryKey: ['guest-conversation'] });
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

export const useLogin = () => useSignInMutation(authApi.login);
export const useVerifyEmail = () => useSignInMutation(authApi.verifyEmail);
export const useResetPassword = () => useSignInMutation(authApi.resetPassword);
export const useLogout = () => useSignOutMutation(authApi.logout);
export const useLogoutEverywhere = () => useSignOutMutation(authApi.logoutEverywhere);

export const useSignup = () => useMutation({ mutationFn: authApi.signup });
export const useResendVerification = () => useMutation({ mutationFn: authApi.resendVerification });
export const useForgotPassword = () => useMutation({ mutationFn: authApi.forgotPassword });
