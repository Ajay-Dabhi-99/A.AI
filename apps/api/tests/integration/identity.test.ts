import { meResponseSchema } from '@a-ai/validation';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveIdentity, hashedIp } from '../../src/plugins/auth.js';
import { SESSION_TTL_MS } from '../../src/modules/auth/session.service.js';
import { generateToken } from '../../src/shared/security/tokens.js';
import {
  buildAuthTestApp,
  cookieValue,
  setCookieFor,
  testEnv,
  WEB_ORIGIN,
  type AuthTestContext,
} from '../helpers/test-app.js';

const GUEST = 'a_ai_guest';
const SESSION = 'a_ai_session';

let ctx: AuthTestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

describe('guest identity', () => {
  it('issues a guest session on the first visit and reuses it afterwards', async () => {
    ctx = await buildAuthTestApp();

    const first = await ctx.app.inject({ method: 'GET', url: '/api/me' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const body = meResponseSchema.parse(first.json());
    expect(body.identity).toEqual({ kind: 'guest', expiresAt: '2026-09-14T10:00:00.000Z' });
    expect(body.quota).toMatchObject({ limit: 20, used: 0, remaining: 20 });

    const cookie = setCookieFor(first, GUEST);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(JSON.stringify(body)).not.toContain(cookie!.value);

    const second = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [GUEST]: cookie!.value },
    });
    expect(setCookieFor(second, GUEST)).toBeUndefined();
    expect(second.json().identity).toEqual(body.identity);
  });

  it('replaces unknown or expired guest cookies with a new guest', async () => {
    ctx = await buildAuthTestApp();

    const unknown = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [GUEST]: generateToken() },
    });
    const replacement = cookieValue(unknown, GUEST);
    expect(replacement).toBeTruthy();

    ctx.clock.advance(24 * 60 * 60 * 1000);
    const expired = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [GUEST]: replacement! },
    });
    expect(cookieValue(expired, GUEST)).not.toBe(replacement);
    expect(expired.json().identity.kind).toBe('guest');
  });
});

describe('session identity', () => {
  it('treats a tampered session cookie as a guest and clears it', async () => {
    ctx = await buildAuthTestApp();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION]: generateToken() },
    });
    expect(response.json().identity.kind).toBe('guest');
    expect(setCookieFor(response, SESSION)?.value).toBe('');
  });

  it('ends a session 30 days after the last activity', async () => {
    ctx = await buildAuthTestApp();
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: { origin: WEB_ORIGIN },
      payload: { email: 'person@example.com', password: 'a long enough password' },
    });
    const verified = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      headers: { origin: WEB_ORIGIN },
      payload: { token: ctx.emails.tokenFor('person@example.com') },
    });
    const session = cookieValue(verified, SESSION)!;

    const active = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION]: session },
    });
    expect(active.json().identity.kind).toBe('user');

    ctx.clock.advance(SESSION_TTL_MS);
    const expired = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION]: session },
    });
    expect(expired.json().identity.kind).toBe('guest');
  });
});

describe('request guards', () => {
  it('blocks state-changing API requests from other origins', async () => {
    ctx = await buildAuthTestApp();
    const blocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'person@example.com', password: 'whatever password' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('FORBIDDEN');

    const noOrigin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'person@example.com', password: 'whatever password' },
    });
    expect(noOrigin.statusCode).toBe(401);
  });

  it('rate limits /api per IP but never the health probes', async () => {
    ctx = await buildAuthTestApp({
      services: { rateLimits: { api: { name: 'api-ip', limit: 2, windowMs: 60_000 } } },
    });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(200);

    const limited = await ctx.app.inject({ method: 'GET', url: '/api/me' });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();

    for (let index = 0; index < 5; index++) {
      expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    }
  });
});

describe('quota enforcement', () => {
  it('stops a guest at the daily limit and reports it through /api/me', async () => {
    ctx = await buildAuthTestApp({ env: testEnv({ GUEST_DAILY_MESSAGE_LIMIT: '2' }) });
    const { app } = ctx;
    // Stand-in for the Phase 2 chat route, which consumes quota the same way.
    app.post('/api/test/message', async (request, reply) => {
      const identity = await resolveIdentity(request, reply, { createGuest: true });
      const subject =
        identity.kind === 'user'
          ? { kind: 'user' as const, id: identity.user.id }
          : { kind: 'guest' as const, id: identity.guest.id };
      return app.services.quota.consume(subject, { ipHash: hashedIp(request) });
    });

    const guest = cookieValue(await app.inject({ method: 'GET', url: '/api/me' }), GUEST)!;
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/test/message',
        headers: { origin: WEB_ORIGIN },
        cookies: { [GUEST]: guest },
      });

    expect((await send()).statusCode).toBe(200);
    expect((await send()).json()).toMatchObject({ used: 2, remaining: 0 });

    const exceeded = await send();
    expect(exceeded.statusCode).toBe(429);
    expect(exceeded.json().error.code).toBe('QUOTA_EXCEEDED');

    const status = meResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/me', cookies: { [GUEST]: guest } })).json(),
    );
    expect(status.quota).toMatchObject({ limit: 2, used: 2, remaining: 0 });
  });
});
