import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ME_QUERY_KEY } from '@/hooks/use-me';
import * as authApi from '@/services/auth';

/** Mutations that change who is signed in refresh the `me` query afterwards. */
function useIdentityMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
}

export const useLogin = () => useIdentityMutation(authApi.login);
export const useVerifyEmail = () => useIdentityMutation(authApi.verifyEmail);
export const useResetPassword = () => useIdentityMutation(authApi.resetPassword);
export const useLogout = () => useIdentityMutation(() => authApi.logout());
export const useLogoutEverywhere = () => useIdentityMutation(() => authApi.logoutEverywhere());

export const useSignup = () => useMutation({ mutationFn: authApi.signup });
export const useResendVerification = () => useMutation({ mutationFn: authApi.resendVerification });
export const useForgotPassword = () => useMutation({ mutationFn: authApi.forgotPassword });
