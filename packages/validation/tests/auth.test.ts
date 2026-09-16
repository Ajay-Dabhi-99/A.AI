import { describe, expect, it } from 'vitest';
import {
  emailRequestSchema,
  profileFormSchema,
  profileUpdateSchema,
  toProfileUpdate,
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
            firstName: null,
            lastName: null,
            phone: null,
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

describe('profile', () => {
  it('accepts a name and phone, and trims them', () => {
    const parsed = profileUpdateSchema.parse({
      firstName: '  Ada  ',
      lastName: "O'Neil-Smith",
      phone: ' +91 98765 43210 ',
    });
    expect(parsed).toEqual({
      firstName: 'Ada',
      lastName: "O'Neil-Smith",
      phone: '+91 98765 43210',
    });
  });

  it('treats blank, null and missing fields as "not set"', () => {
    expect(profileUpdateSchema.parse({ firstName: '   ', lastName: null })).toEqual({
      firstName: null,
      lastName: null,
      phone: null,
    });
  });

  it('rejects digits in a name and a phone that is not a number', () => {
    const name = profileUpdateSchema.safeParse({ firstName: 'Ada2' });
    expect(name.success).toBe(false);
    expect(name.error?.issues[0]?.message).toBe('Use letters, spaces, hyphens or apostrophes');

    const phone = profileUpdateSchema.safeParse({ phone: 'call me' });
    expect(phone.error?.issues[0]?.message).toBe('Use digits, and + ( ) - if you need them');

    const short = profileUpdateSchema.safeParse({ phone: '12345' });
    expect(short.error?.issues[0]?.message).toBe(
      'Enter at least 7 digits, including the country code',
    );
  });

  it('rejects names longer than the column allows', () => {
    expect(profileUpdateSchema.safeParse({ firstName: 'a'.repeat(61) }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ firstName: 'a'.repeat(60) }).success).toBe(true);
  });

  it('lets a form hold blanks and converts them to a request', () => {
    const values = profileFormSchema.parse({ firstName: 'Ada', lastName: '', phone: '' });
    expect(toProfileUpdate(values)).toEqual({ firstName: 'Ada', lastName: null, phone: null });
  });
});
