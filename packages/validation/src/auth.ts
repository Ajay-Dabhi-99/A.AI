import type {
  AcceptedResponse,
  AuthUser,
  AuthUserResponse,
  MeResponse,
  QuotaSummary,
} from '@a-ai/shared-types';
import { z } from 'zod';
import { attachmentLimitsSchema } from './attachments.js';

/**
 * Auth request and response schemas. The API validates requests with these
 * exact schemas and the web forms reuse them, so both sides agree on the rules.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string({ error: 'Enter your email address' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email address')
  .max(254, 'Email address is too long')
  .pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string({ error: 'Enter a password' })
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

/** Tokens from emailed links: 32 random bytes, base64url. */
export const linkTokenSchema = z
  .string({ error: 'This link is invalid' })
  .regex(/^[A-Za-z0-9_-]{32,128}$/, 'This link is invalid');

export const signupRequestSchema = z
  .object({ email: emailSchema, password: passwordSchema })
  .refine((data) => data.password.trim().toLowerCase() !== data.email, {
    path: ['password'],
    message: 'Your password must not be your email address',
  });

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: 'Enter your password' })
    .min(1, 'Enter your password')
    .max(PASSWORD_MAX_LENGTH),
});

export const emailRequestSchema = z.object({ email: emailSchema });

export const verifyEmailRequestSchema = z.object({ token: linkTokenSchema });

export const resetPasswordRequestSchema = z.object({
  token: linkTokenSchema,
  password: passwordSchema,
});

export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type EmailRequest = z.infer<typeof emailRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  role: z.enum(['user', 'admin']),
  createdAt: z.string(),
}) satisfies z.ZodType<AuthUser>;

export const quotaSummarySchema = z.object({
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetsAt: z.string(),
}) satisfies z.ZodType<QuotaSummary>;

export const meResponseSchema = z.object({
  identity: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), user: authUserSchema }),
    z.object({ kind: z.literal('guest'), expiresAt: z.string() }),
  ]),
  quota: quotaSummarySchema,
  limits: z.object({
    compareMaxModels: z.number().int().positive(),
    attachments: attachmentLimitsSchema,
  }),
}) satisfies z.ZodType<MeResponse>;

export const authUserResponseSchema = z.object({
  user: authUserSchema,
}) satisfies z.ZodType<AuthUserResponse>;

export const acceptedResponseSchema = z.object({
  status: z.literal('accepted'),
}) satisfies z.ZodType<AcceptedResponse>;
