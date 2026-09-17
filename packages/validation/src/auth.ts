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

export const NAME_MAX_LENGTH = 60;
export const PHONE_MAX_LENGTH = 24;

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}'’ .-]*$/u;
const PHONE_PATTERN = /^(\+?[\d ()-]+)?$/;

/** First and last name: required at signup and cannot be cleared afterwards. */
const nameField = (label: 'first name' | 'last name') =>
  z
    .string({ error: `Enter your ${label}` })
    .trim()
    .min(1, { error: `Enter your ${label}`, abort: true })
    .max(NAME_MAX_LENGTH, `Use at most ${NAME_MAX_LENGTH} characters`)
    .regex(NAME_PATTERN, 'Use letters, spaces, hyphens or apostrophes');

const firstNameField = nameField('first name');
const lastNameField = nameField('last name');

const phoneField = z
  .string()
  .trim()
  .max(PHONE_MAX_LENGTH, `Use at most ${PHONE_MAX_LENGTH} characters`)
  .regex(PHONE_PATTERN, 'Use digits, and + ( ) - if you need them')
  .refine(
    (value) => value === '' || value.replace(/\D/g, '').length >= 7,
    'Enter at least 7 digits, including the country code',
  );

/** The shape a form holds: plain strings, where a blank phone means "not set". */
export const profileFormSchema = z.object({
  firstName: firstNameField,
  lastName: lastNameField,
  phone: phoneField,
});

/**
 * The request the API accepts; one request replaces the whole profile. Names
 * are required. The phone may be blank, null or missing, each of which clears it.
 */
const optionalField = <Field extends z.ZodType<string, unknown>>(field: Field) =>
  field
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));

export const profileUpdateSchema = z.object({
  firstName: firstNameField,
  lastName: lastNameField,
  phone: optionalField(phoneField),
});

/** Tokens from emailed links: 32 random bytes, base64url. */
export const linkTokenSchema = z
  .string({ error: 'This link is invalid' })
  .regex(/^[A-Za-z0-9_-]{32,128}$/, 'This link is invalid');

export const signupRequestSchema = z
  .object({
    firstName: firstNameField,
    lastName: lastNameField,
    email: emailSchema,
    password: passwordSchema,
  })
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
export type ProfileUpdateRequest = z.infer<typeof profileUpdateSchema>;
export type ProfileFormValues = z.infer<typeof profileFormSchema>;

/** A blank phone becomes null, which clears it. */
export function toProfileUpdate(values: ProfileFormValues): ProfileUpdateRequest {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    phone: values.phone || null,
  };
}

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  // Defaults keep the web app working with an API from before MODEL-066.
  interests: z.array(z.string()).default([]),
  interestsSetAt: z.string().nullable().default(null),
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
