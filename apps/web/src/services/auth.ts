import type { AcceptedResponse, AuthUserResponse, MeResponse } from '@a-ai/shared-types';
import {
  acceptedResponseSchema,
  authUserResponseSchema,
  meResponseSchema,
  type EmailRequest,
  type InterestsUpdateRequest,
  type LoginRequest,
  type ProfileUpdateRequest,
  type ResetPasswordRequest,
  type SignupRequest,
  type VerifyEmailRequest,
} from '@a-ai/validation';
import { apiRequest } from './api';

export const fetchMe = (signal?: AbortSignal): Promise<MeResponse> =>
  apiRequest('/api/me', { schema: meResponseSchema, ...(signal ? { signal } : {}) });

export const updateProfile = (input: ProfileUpdateRequest): Promise<AuthUserResponse> =>
  apiRequest('/api/me/profile', {
    method: 'PATCH',
    body: input,
    schema: authUserResponseSchema,
  });

export const updateInterests = (input: InterestsUpdateRequest): Promise<AuthUserResponse> =>
  apiRequest('/api/me/interests', {
    method: 'PATCH',
    body: input,
    schema: authUserResponseSchema,
  });

export const signup = (input: SignupRequest): Promise<AcceptedResponse> =>
  apiRequest('/api/auth/signup', { method: 'POST', body: input, schema: acceptedResponseSchema });

export const login = (input: LoginRequest): Promise<AuthUserResponse> =>
  apiRequest('/api/auth/login', { method: 'POST', body: input, schema: authUserResponseSchema });

export const logout = (): Promise<void> => apiRequest('/api/auth/logout', { method: 'POST' });

export const logoutEverywhere = (): Promise<void> =>
  apiRequest('/api/auth/logout-all', { method: 'POST' });

export const verifyEmail = (input: VerifyEmailRequest): Promise<AuthUserResponse> =>
  apiRequest('/api/auth/verify-email', {
    method: 'POST',
    body: input,
    schema: authUserResponseSchema,
  });

export const resendVerification = (input: EmailRequest): Promise<AcceptedResponse> =>
  apiRequest('/api/auth/resend-verification', {
    method: 'POST',
    body: input,
    schema: acceptedResponseSchema,
  });

export const forgotPassword = (input: EmailRequest): Promise<AcceptedResponse> =>
  apiRequest('/api/auth/forgot-password', {
    method: 'POST',
    body: input,
    schema: acceptedResponseSchema,
  });

export const resetPassword = (input: ResetPasswordRequest): Promise<AuthUserResponse> =>
  apiRequest('/api/auth/reset-password', {
    method: 'POST',
    body: input,
    schema: authUserResponseSchema,
  });
