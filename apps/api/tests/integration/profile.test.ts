import {
  apiErrorBodySchema,
  authUserResponseSchema,
  meResponseSchema,
  personalInstructionsResponseSchema,
} from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAuthTestApp,
  cookieValue,
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

function patchProfile(app: FastifyInstance, payload: object, cookies?: Record<string, string>) {
  return app.inject({
    method: 'PATCH',
    url: '/api/me/profile',
    headers: { origin: WEB_ORIGIN },
    payload,
    ...(cookies ? { cookies } : {}),
  });
}

async function signedIn(): Promise<{ app: FastifyInstance; cookies: Record<string, string> }> {
  ctx = await buildAuthTestApp();
  const { app, emails } = ctx;
  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    headers: { origin: WEB_ORIGIN },
    payload: { firstName: 'Grace', lastName: 'Hopper', email, password },
  });
  const verified = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    headers: { origin: WEB_ORIGIN },
    payload: { token: emails.tokenFor(email) },
  });
  const session = cookieValue(verified, SESSION);
  if (!session) throw new Error('verification did not set a session cookie');
  return { app, cookies: { [SESSION]: session } };
}

describe('personal instructions (MODEL-069)', () => {
  const save = (app: FastifyInstance, payload: object, cookies?: Record<string, string>) =>
    app.inject({
      method: 'PATCH',
      url: '/api/me/instructions',
      headers: { origin: WEB_ORIGIN },
      payload,
      ...(cookies ? { cookies } : {}),
    });

  it('starts empty and on, then saves, clears and turns off', async () => {
    const { app, cookies } = await signedIn();
    const initial = await app.inject({ url: '/api/me/instructions', cookies });
    expect(personalInstructionsResponseSchema.parse(initial.json())).toEqual({
      instructions: { about: null, style: null, enabled: true },
    });

    const saved = await save(
      app,
      { about: ' I teach maths. ', style: 'Be brief.', enabled: true },
      cookies,
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({
      instructions: { about: 'I teach maths.', style: 'Be brief.', enabled: true },
    });

    await save(app, { about: '', style: 'Be brief.', enabled: false }, cookies);
    expect((await app.inject({ url: '/api/me/instructions', cookies })).json()).toEqual({
      instructions: { about: null, style: 'Be brief.', enabled: false },
    });
  });

  it('rejects bad input and guests', async () => {
    const { app, cookies } = await signedIn();
    const long = await save(app, { about: 'x'.repeat(1_501), style: null, enabled: true }, cookies);
    expect(long.statusCode).toBe(400);
    expect(apiErrorBodySchema.parse(long.json()).error.code).toBe('VALIDATION_ERROR');
    expect((await save(app, { about: null }, cookies)).statusCode).toBe(400);
    expect((await save(app, { about: null, style: null, enabled: true })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/me/instructions' })).statusCode).toBe(401);
  });
});

describe('PATCH /api/me/interests', () => {
  const patchInterests = (
    app: FastifyInstance,
    payload: object,
    cookies?: Record<string, string>,
  ) =>
    app.inject({
      method: 'PATCH',
      url: '/api/me/interests',
      headers: { origin: WEB_ORIGIN },
      payload,
      ...(cookies ? { cookies } : {}),
    });

  it('starts unanswered, then saves up to three topics', async () => {
    const { app, cookies } = await signedIn();
    const before = meResponseSchema.parse((await app.inject({ url: '/api/me', cookies })).json());
    expect(before.identity).toMatchObject({ user: { interests: [], interestsSetAt: null } });

    const saved = await patchInterests(app, { interests: ['Travel', ' Street  food '] }, cookies);
    expect(saved.statusCode).toBe(200);
    const { user } = authUserResponseSchema.parse(saved.json());
    expect(user.interests).toEqual(['Travel', 'Street food']);
    expect(user.interestsSetAt).toEqual(expect.any(String));

    const after = meResponseSchema.parse((await app.inject({ url: '/api/me', cookies })).json());
    expect(after.identity).toMatchObject({ user: { interests: ['Travel', 'Street food'] } });
  });

  it('records a skip as an empty list', async () => {
    const { app, cookies } = await signedIn();
    const skipped = authUserResponseSchema.parse(
      (await patchInterests(app, { interests: [] }, cookies)).json(),
    ).user;
    expect(skipped).toMatchObject({ interests: [], interestsSetAt: expect.any(String) });
  });

  it('rejects invalid topics and guests', async () => {
    const { app, cookies } = await signedIn();
    const tooMany = await patchInterests(app, { interests: ['Aa', 'Bb', 'Cc', 'Dd'] }, cookies);
    expect(tooMany.statusCode).toBe(400);
    expect(apiErrorBodySchema.parse(tooMany.json()).error.code).toBe('VALIDATION_ERROR');
    expect((await patchInterests(app, { interests: ['Aa', 'aa'] }, cookies)).statusCode).toBe(400);
    expect((await patchInterests(app, { interests: ['Aa'] })).statusCode).toBe(401);
  });
});

describe('PATCH /api/me/profile', () => {
  it('starts with the name given at signup', async () => {
    const { app, cookies } = await signedIn();

    const identity = meResponseSchema.parse((await app.inject({ url: '/api/me', cookies })).json());
    expect(identity.identity).toMatchObject({
      kind: 'user',
      user: { firstName: 'Grace', lastName: 'Hopper', phone: null },
    });
  });

  it('saves the profile and returns it from /api/me', async () => {
    const { app, cookies } = await signedIn();

    const response = await patchProfile(
      app,
      { firstName: '  Ada  ', lastName: 'Lovelace', phone: '+91 98765 43210' },
      cookies,
    );

    expect(response.statusCode).toBe(200);
    const { user } = authUserResponseSchema.parse(response.json());
    expect(user).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+91 98765 43210',
    });

    const identity = meResponseSchema.parse((await app.inject({ url: '/api/me', cookies })).json());
    expect(identity.identity).toMatchObject({ kind: 'user', user: { firstName: 'Ada' } });
  });

  it('clears a phone sent blank', async () => {
    const { app, cookies } = await signedIn();
    await patchProfile(app, { ...names, phone: '9876543210' }, cookies);

    const response = await patchProfile(app, { ...names, phone: '' }, cookies);

    const { user } = authUserResponseSchema.parse(response.json());
    expect(user).toMatchObject({ ...names, phone: null });
  });

  it('refuses to clear a name and keeps the stored one', async () => {
    const { app, cookies } = await signedIn();

    const response = await patchProfile(app, { firstName: '', lastName: null }, cookies);

    expect(response.statusCode).toBe(400);
    const body = apiErrorBodySchema.parse(response.json());
    expect(body.error.details?.map((issue) => issue.path).sort()).toEqual([
      'firstName',
      'lastName',
    ]);
    const identity = meResponseSchema.parse((await app.inject({ url: '/api/me', cookies })).json());
    expect(identity.identity).toMatchObject({ kind: 'user', user: { firstName: 'Grace' } });
  });

  it('rejects a phone number that is not a number, naming the field', async () => {
    const { app, cookies } = await signedIn();

    const response = await patchProfile(app, { ...names, phone: 'call me maybe' }, cookies);

    expect(response.statusCode).toBe(400);
    const body = apiErrorBodySchema.parse(response.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.map((issue) => issue.path)).toContain('phone');
  });

  it('rejects a name with digits and keeps the stored profile unchanged', async () => {
    const { app, cookies } = await signedIn();
    await patchProfile(app, names, cookies);

    const rejected = await patchProfile(app, { ...names, firstName: 'Ada2' }, cookies);
    expect(rejected.statusCode).toBe(400);

    const identity = meResponseSchema.parse((await app.inject({ url: '/api/me', cookies })).json());
    expect(identity.identity).toMatchObject({ kind: 'user', user: { firstName: 'Ada' } });
  });

  it('requires a signed-in session', async () => {
    ctx = await buildAuthTestApp();

    const response = await patchProfile(ctx.app, names);

    expect(response.statusCode).toBe(401);
    expect(apiErrorBodySchema.parse(response.json()).error.code).toBe('AUTH_REQUIRED');
  });
});
