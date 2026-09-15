import { describe, expect, it } from 'vitest';
import {
  emailRequestSchema,
  loginRequestSchema,
  meResponseSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
  verifyEmailRequestSchema,
} from '../src/index.js';

const token = 'a'.repeat(43);

describe('signupRequestSchema', () => {
  it('normalizes the email to trimmed lowercase', () => {
    const parsed = signupRequestSchema.parse({
      email: '  Ajay@Example.COM ',
      password: 'correct horse battery',
    });
    expect(parsed.email).toBe('ajay@example.com');
  });

  it('enforces password length bounds', () => {
    const short = signupRequestSchema.safeParse({ email: 'a@b.co', password: 'short' });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toBe('Use at least 10 characters');

    const long = signupRequestSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) });
    expect(long.success).toBe(false);
  });

  it('rejects a password equal to the email', () => {
    const result = signupRequestSchema.safeParse({
      email: 'someone@example.com',
      password: 'Someone@Example.com',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['password']);
  });

  it('rejects malformed emails', () => {
    expect(emailRequestSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(emailRequestSchema.safeParse({ email: '' }).success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('does not apply the signup password policy (old passwords still log in)', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('link token schemas', () => {
  it('accept base64url tokens and reject anything else', () => {
    expect(verifyEmailRequestSchema.safeParse({ token }).success).toBe(true);
    expect(verifyEmailRequestSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(verifyEmailRequestSchema.safeParse({ token: `${token}<script>` }).success).toBe(false);
    expect(
      resetPasswordRequestSchema.safeParse({ token, password: 'a new long password' }).success,
    ).toBe(true);
  });
});

describe('meResponseSchema', () => {
  const quota = { limit: 20, used: 3, remaining: 17, resetsAt: '2026-09-14T00:00:00.000Z' };
  const limits = {
    compareMaxModels: 2,
    attachments: {
      enabled: false,
      maxBytes: 5_242_880,
      maxPerMessage: 4,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
  };

  it('accepts user and guest identities', () => {
    expect(
      meResponseSchema.safeParse({
        identity: {
          kind: 'user',
          user: {
            id: 'u1',
            email: 'a@b.co',
            emailVerified: true,
            role: 'user',
            createdAt: '2026-09-13T00:00:00.000Z',
          },
        },
        quota,
        limits,
      }).success,
    ).toBe(true);
    expect(
      meResponseSchema.safeParse({
        identity: { kind: 'guest', expiresAt: '2026-09-14T00:00:00.000Z' },
        quota,
        limits,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown identity kind', () => {
    expect(meResponseSchema.safeParse({ identity: { kind: 'admin' }, quota }).success).toBe(false);
  });
});
