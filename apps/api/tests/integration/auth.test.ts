import {
  acceptedResponseSchema,
  apiErrorBodySchema,
  authUserResponseSchema,
  meResponseSchema,
} from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAuthTestApp,
  cookieValue,
  setCookieFor,
  WEB_ORIGIN,
  type AuthTestContext,
} from '../helpers/test-app.js';

const SESSION = 'a_ai_session';
const email = 'person@example.com';
const password = 'a long enough password';
const names = { firstName: 'Ada', lastName: 'Lovelace' };

let ctx: AuthTestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

function post(
  app: FastifyInstance,
  url: string,
  payload?: object,
  cookies?: Record<string, string>,
) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: WEB_ORIGIN },
    ...(payload ? { payload } : {}),
    ...(cookies ? { cookies } : {}),
  });
}

function me(app: FastifyInstance, cookies: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url: '/api/me', cookies });
}

async function signupAndVerify(context: AuthTestContext): Promise<string> {
  await post(context.app, '/api/auth/signup', { ...names, email, password });
  const verified = await post(context.app, '/api/auth/verify-email', {
    token: context.emails.tokenFor(email),
  });
  const session = cookieValue(verified, SESSION);
  if (!session) throw new Error('verification did not set a session cookie');
  return session;
}

describe('signup → verify → session', () => {
  it('completes the full account flow over HTTP', async () => {
    ctx = await buildAuthTestApp();
    const { app, emails } = ctx;

    const signup = await post(app, '/api/auth/signup', {
      ...names,
      email: ' Person@Example.com ',
      password,
    });
    expect(signup.statusCode).toBe(202);
    expect(acceptedResponseSchema.parse(signup.json())).toEqual({ status: 'accepted' });
    expect(cookieValue(signup, SESSION)).toBeUndefined();

    const early = await post(app, '/api/auth/login', { email, password });
    expect(early.statusCode).toBe(403);
    expect(early.json().error.code).toBe('EMAIL_NOT_VERIFIED');

    const verified = await post(app, '/api/auth/verify-email', { token: emails.tokenFor(email) });
    expect(verified.statusCode).toBe(200);
    expect(authUserResponseSchema.parse(verified.json()).user).toMatchObject({
      email,
      emailVerified: true,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    const cookie = setCookieFor(verified, SESSION);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.expires?.getTime()).toBeGreaterThan(Date.now());

    const current = meResponseSchema.parse((await me(app, { [SESSION]: cookie!.value })).json());
    expect(current.identity).toMatchObject({ kind: 'user', user: { email } });
    expect(current.quota.limit).toBe(200);
  });

  it('rejects a verification link that was already used', async () => {
    ctx = await buildAuthTestApp();
    await post(ctx.app, '/api/auth/signup', { ...names, email, password });
    const token = ctx.emails.tokenFor(email);
    await post(ctx.app, '/api/auth/verify-email', { token });

    const reused = await post(ctx.app, '/api/auth/verify-email', { token });
    expect(reused.statusCode).toBe(400);
    expect(apiErrorBodySchema.parse(reused.json()).error.code).toBe('TOKEN_INVALID');
  });

  it('returns field-level validation details', async () => {
    ctx = await buildAuthTestApp();
    const response = await post(ctx.app, '/api/auth/signup', {
      firstName: ' ',
      email: 'nope',
      password: 'short',
    });
    expect(response.statusCode).toBe(400);
    const body = apiErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.map((issue) => issue.path).sort()).toEqual([
      'email',
      'firstName',
      'lastName',
      'password',
    ]);
  });

  it('answers signup identically whether or not the email is registered', async () => {
    ctx = await buildAuthTestApp();
    await signupAndVerify(ctx);

    const again = await post(ctx.app, '/api/auth/signup', {
      ...names,
      email,
      password: 'an attacker password',
    });
    const fresh = await post(ctx.app, '/api/auth/signup', {
      ...names,
      email: 'new@example.com',
      password,
    });

    expect(again.statusCode).toBe(fresh.statusCode);
    expect(again.body).toBe(fresh.body);
    expect(ctx.emails.lastTo(email)?.subject).toBe('You already have an A.ai account');
  });
});

describe('login and logout', () => {
  it('uses one message for wrong passwords and unknown accounts', async () => {
    ctx = await buildAuthTestApp();
    await signupAndVerify(ctx);

    const wrong = await post(ctx.app, '/api/auth/login', { email, password: 'wrong password!!' });
    const unknown = await post(ctx.app, '/api/auth/login', {
      email: 'ghost@example.com',
      password,
    });

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
    expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('signs in, then logout revokes the session and clears the cookie', async () => {
    ctx = await buildAuthTestApp();
    await signupAndVerify(ctx);

    const login = await post(ctx.app, '/api/auth/login', { email, password });
    expect(login.statusCode).toBe(200);
    const session = cookieValue(login, SESSION)!;

    const logout = await post(ctx.app, '/api/auth/logout', undefined, { [SESSION]: session });
    expect(logout.statusCode).toBe(204);
    expect(setCookieFor(logout, SESSION)?.value).toBe('');

    const after = meResponseSchema.parse((await me(ctx.app, { [SESSION]: session })).json());
    expect(after.identity.kind).toBe('guest');
  });

  it('logout-all signs out every device and requires a user', async () => {
    ctx = await buildAuthTestApp();
    const first = await signupAndVerify(ctx);
    const second = cookieValue(
      await post(ctx.app, '/api/auth/login', { email, password }),
      SESSION,
    )!;

    const asGuest = await post(ctx.app, '/api/auth/logout-all');
    expect(asGuest.statusCode).toBe(401);
    expect(asGuest.json().error.code).toBe('AUTH_REQUIRED');

    expect(
      (await post(ctx.app, '/api/auth/logout-all', undefined, { [SESSION]: first })).statusCode,
    ).toBe(204);
    for (const token of [first, second]) {
      expect(
        meResponseSchema.parse((await me(ctx.app, { [SESSION]: token })).json()).identity.kind,
      ).toBe('guest');
    }
  });

  it('rate limits repeated login attempts for one account', async () => {
    ctx = await buildAuthTestApp({
      services: {
        rateLimits: { loginByEmail: { name: 'login-email', limit: 3, windowMs: 60_000 } },
      },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await post(ctx.app, '/api/auth/login', { email, password })).statusCode).toBe(401);
    }
    const limited = await post(ctx.app, '/api/auth/login', { email, password });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('password reset', () => {
  it('replaces the password and invalidates existing sessions', async () => {
    ctx = await buildAuthTestApp();
    const oldSession = await signupAndVerify(ctx);

    const unknown = await post(ctx.app, '/api/auth/forgot-password', {
      email: 'ghost@example.com',
    });
    const known = await post(ctx.app, '/api/auth/forgot-password', { email });
    expect(unknown.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);

    const reset = await post(ctx.app, '/api/auth/reset-password', {
      token: ctx.emails.tokenFor(email),
      password: 'brand new password 42',
    });
    expect(reset.statusCode).toBe(200);
    const newSession = cookieValue(reset, SESSION)!;

    expect(
      meResponseSchema.parse((await me(ctx.app, { [SESSION]: oldSession })).json()).identity.kind,
    ).toBe('guest');
    expect(
      meResponseSchema.parse((await me(ctx.app, { [SESSION]: newSession })).json()).identity.kind,
    ).toBe('user');
    expect((await post(ctx.app, '/api/auth/login', { email, password })).statusCode).toBe(401);
    expect(
      (await post(ctx.app, '/api/auth/login', { email, password: 'brand new password 42' }))
        .statusCode,
    ).toBe(200);
  });

  it('resend-verification accepts unknown emails without sending anything', async () => {
    ctx = await buildAuthTestApp();
    const response = await post(ctx.app, '/api/auth/resend-verification', {
      email: 'ghost@example.com',
    });
    expect(response.statusCode).toBe(202);
    expect(ctx.emails.messages).toHaveLength(0);
  });
});
