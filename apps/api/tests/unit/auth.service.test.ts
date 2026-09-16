import { describe, expect, it } from 'vitest';
import {
  AuthService,
  RESET_TOKEN_TTL_MS,
  toAuthUser,
  VERIFICATION_TOKEN_TTL_MS,
} from '../../src/modules/auth/auth.service.js';
import { SessionService } from '../../src/modules/auth/session.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { CapturingEmailSender, fakeHasher, silentLogger, TestClock } from '../helpers/fakes.js';
import { createMemoryRepositories } from '../helpers/memory-repositories.js';

const SECRET = 'auth-unit-test-secret-long-enough-123';
const APP_URL = 'https://app.a-ai.test';
const meta = { userAgent: 'vitest', ipHash: 'hashed-ip' };
const email = 'person@example.com';
const password = 'a long enough password';
const names = { firstName: 'Ada', lastName: 'Lovelace' };

function setup() {
  const repositories = createMemoryRepositories();
  const emails = new CapturingEmailSender();
  const clock = new TestClock();
  const logger = silentLogger();
  const sessions = new SessionService({ sessions: repositories.sessions, secret: SECRET, clock });
  const auth = new AuthService({
    repositories,
    transaction: repositories.transaction,
    hasher: fakeHasher,
    sessions,
    email: emails,
    secret: SECRET,
    appUrl: APP_URL,
    clock,
    logger,
  });
  return { repositories, emails, clock, logger, sessions, auth };
}

type Context = ReturnType<typeof setup>;

async function verifiedAccount(ctx: Context) {
  await ctx.auth.signup({ ...names, email, password });
  return ctx.auth.verifyEmail(ctx.emails.tokenFor(email), meta);
}

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AppError)) throw new Error(`expected AppError, got ${String(error)}`);
  return error;
}

describe('signup', () => {
  it('creates an unverified account and emails a verification link', async () => {
    const ctx = setup();
    await ctx.auth.signup({ ...names, email, password });

    const user = ctx.repositories.data.users[0];
    expect(user).toMatchObject(names);
    expect(user).toMatchObject({
      email,
      emailVerifiedAt: null,
      passwordHash: `fake-hash:${password}`,
    });

    const message = ctx.emails.lastTo(email);
    expect(message?.subject).toBe('Verify your email for A.ai');
    expect(message?.text).toContain(`${APP_URL}/verify-email#token=`);
    const token = ctx.emails.tokenFor(email);
    expect(JSON.stringify(ctx.repositories.data.authTokens)).not.toContain(token);
  });

  it('for an existing verified account: sends an "account exists" email and changes nothing', async () => {
    const ctx = setup();
    await verifiedAccount(ctx);
    const before = structuredClone(ctx.repositories.data.users[0]);

    await ctx.auth.signup({ ...names, email, password: 'someone else trying a password' });

    expect(ctx.repositories.data.users).toHaveLength(1);
    expect(ctx.repositories.data.users[0]).toEqual(before);
    expect(ctx.emails.lastTo(email)?.subject).toBe('You already have an A.ai account');
  });

  it('for an existing unverified account: the latest signup wins and older links stop working', async () => {
    const ctx = setup();
    await ctx.auth.signup({ ...names, email, password });
    const firstToken = ctx.emails.tokenFor(email);

    await ctx.auth.signup({
      firstName: 'Grace',
      lastName: 'Hopper',
      email,
      password: 'the newer password here',
    });
    const secondToken = ctx.emails.tokenFor(email);

    expect(ctx.repositories.data.users).toHaveLength(1);
    expect(ctx.repositories.data.users[0]).toMatchObject({
      passwordHash: 'fake-hash:the newer password here',
      firstName: 'Grace',
      lastName: 'Hopper',
    });
    expect((await appError(ctx.auth.verifyEmail(firstToken, meta))).code).toBe('TOKEN_INVALID');
    await expect(ctx.auth.verifyEmail(secondToken, meta)).resolves.toBeDefined();
  });

  it('handles two simultaneous signups for the same email without failing either', async () => {
    const ctx = setup();
    await expect(
      Promise.all([
        ctx.auth.signup({ ...names, email, password }),
        ctx.auth.signup({ ...names, email, password }),
      ]),
    ).resolves.toBeDefined();
    expect(ctx.repositories.data.users).toHaveLength(1);
  });

  it('does not fail when the email cannot be delivered, and logs it', async () => {
    const ctx = setup();
    ctx.emails.failNext = true;
    await expect(ctx.auth.signup({ ...names, email, password })).resolves.toBeUndefined();
    expect(ctx.logger.error).toHaveBeenCalledOnce();
  });
});

describe('verifyEmail', () => {
  it('verifies the account, signs the user in, and works only once', async () => {
    const ctx = setup();
    await ctx.auth.signup({ ...names, email, password });
    const token = ctx.emails.tokenFor(email);

    const signedIn = await ctx.auth.verifyEmail(token, meta);
    expect(toAuthUser(signedIn.user).emailVerified).toBe(true);
    expect((await ctx.sessions.resolve(signedIn.session.token))?.user.email).toBe(email);

    expect((await appError(ctx.auth.verifyEmail(token, meta))).code).toBe('TOKEN_INVALID');
  });

  it('rejects a link older than 24 hours', async () => {
    const ctx = setup();
    await ctx.auth.signup({ ...names, email, password });
    ctx.clock.advance(VERIFICATION_TOKEN_TTL_MS);
    const error = await appError(ctx.auth.verifyEmail(ctx.emails.tokenFor(email), meta));
    expect(error).toMatchObject({ code: 'TOKEN_INVALID', statusCode: 400 });
  });
});

describe('login', () => {
  it('signs in a verified user', async () => {
    const ctx = setup();
    await verifiedAccount(ctx);
    const result = await ctx.auth.login({ email, password }, meta);
    expect(result.user.email).toBe(email);
    expect(await ctx.sessions.resolve(result.session.token)).not.toBeNull();
  });

  it('gives the same error for an unknown email and a wrong password', async () => {
    const ctx = setup();
    await verifiedAccount(ctx);
    const unknown = await appError(ctx.auth.login({ email: 'nobody@example.com', password }, meta));
    const wrong = await appError(ctx.auth.login({ email, password: 'not the password' }, meta));

    expect(unknown.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.message).toBe(wrong.message);
  });

  it('refuses an unverified account only after the password is correct', async () => {
    const ctx = setup();
    await ctx.auth.signup({ ...names, email, password });
    expect(
      (await appError(ctx.auth.login({ email, password: 'wrong password!' }, meta))).code,
    ).toBe('INVALID_CREDENTIALS');
    expect((await appError(ctx.auth.login({ email, password }, meta))).code).toBe(
      'EMAIL_NOT_VERIFIED',
    );
  });
});

describe('resendVerification', () => {
  it('sends a fresh link to unverified accounts and invalidates the previous one', async () => {
    const ctx = setup();
    await ctx.auth.signup({ ...names, email, password });
    const oldToken = ctx.emails.tokenFor(email);

    await ctx.auth.resendVerification(email);
    const newToken = ctx.emails.tokenFor(email);

    expect(newToken).not.toBe(oldToken);
    expect((await appError(ctx.auth.verifyEmail(oldToken, meta))).code).toBe('TOKEN_INVALID');
    await expect(ctx.auth.verifyEmail(newToken, meta)).resolves.toBeDefined();
  });

  it('sends nothing for unknown or already verified emails', async () => {
    const ctx = setup();
    await verifiedAccount(ctx);
    const sent = ctx.emails.messages.length;
    await ctx.auth.resendVerification(email);
    await ctx.auth.resendVerification('nobody@example.com');
    expect(ctx.emails.messages).toHaveLength(sent);
  });
});

describe('password reset', () => {
  it('sends nothing for an unknown email', async () => {
    const ctx = setup();
    await ctx.auth.forgotPassword('nobody@example.com');
    expect(ctx.emails.messages).toHaveLength(0);
  });

  it('resets the password, signs out every other session, and notifies the user', async () => {
    const ctx = setup();
    const { session: oldSession } = await verifiedAccount(ctx);

    await ctx.auth.forgotPassword(email);
    expect(ctx.emails.lastTo(email)?.text).toContain(`${APP_URL}/reset-password#token=`);
    const token = ctx.emails.tokenFor(email);

    const result = await ctx.auth.resetPassword({ token, password: 'brand new password 42' }, meta);

    expect(await ctx.sessions.resolve(oldSession.token)).toBeNull();
    expect(await ctx.sessions.resolve(result.session.token)).not.toBeNull();
    await expect(
      ctx.auth.login({ email, password: 'brand new password 42' }, meta),
    ).resolves.toBeDefined();
    expect((await appError(ctx.auth.login({ email, password }, meta))).code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(ctx.emails.lastTo(email)?.subject).toBe('Your A.ai password was changed');
  });

  it('allows each reset link once and only for 1 hour', async () => {
    const ctx = setup();
    await verifiedAccount(ctx);

    await ctx.auth.forgotPassword(email);
    const token = ctx.emails.tokenFor(email);
    await ctx.auth.resetPassword({ token, password: 'brand new password 42' }, meta);
    expect(
      (await appError(ctx.auth.resetPassword({ token, password: 'another new password' }, meta)))
        .code,
    ).toBe('TOKEN_INVALID');

    await ctx.auth.forgotPassword(email);
    const expiring = ctx.emails.tokenFor(email);
    ctx.clock.advance(RESET_TOKEN_TTL_MS);
    expect(
      (
        await appError(
          ctx.auth.resetPassword({ token: expiring, password: 'another new password' }, meta),
        )
      ).code,
    ).toBe('TOKEN_INVALID');
  });

  it('verifies an unverified account, since the link proves inbox access', async () => {
    const ctx = setup();
    await ctx.auth.signup({ ...names, email, password });
    await ctx.auth.forgotPassword(email);
    const result = await ctx.auth.resetPassword(
      { token: ctx.emails.tokenFor(email), password: 'brand new password 42' },
      meta,
    );
    expect(toAuthUser(result.user).emailVerified).toBe(true);
  });
});

describe('logout', () => {
  it('revokes one session or all of them', async () => {
    const ctx = setup();
    const { user, session } = await verifiedAccount(ctx);
    const other = await ctx.auth.login({ email, password }, meta);

    await ctx.auth.logout(session.token);
    expect(await ctx.sessions.resolve(session.token)).toBeNull();
    expect(await ctx.sessions.resolve(other.session.token)).not.toBeNull();

    await ctx.auth.logoutEverywhere(user.id);
    expect(await ctx.sessions.resolve(other.session.token)).toBeNull();
  });
});
