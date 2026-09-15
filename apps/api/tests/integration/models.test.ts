import { randomUUID } from 'node:crypto';
import {
  meResponseSchema,
  modelCatalogResponseSchema,
  modelsResponseSchema,
  modelUpdateResponseSchema,
} from '@a-ai/validation';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryModelRegistry,
  type MemoryModelRegistry,
} from '../helpers/memory-model-registry.js';
import {
  buildChatTestApp,
  cookieValue,
  WEB_ORIGIN,
  type ChatTestContext,
} from '../helpers/test-app.js';

const SESSION = 'a_ai_session';

let ctx: (ChatTestContext & { registry: MemoryModelRegistry }) | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

/** A chat app whose registry also lists a model for a provider with no key. */
async function setup() {
  const registry = createMemoryModelRegistry();
  const context = await buildChatTestApp({ services: { modelRegistry: registry } });
  context.provider.setScripts([
    { type: 'delta', text: 'ok' },
    { type: 'done', finishReason: 'stop' },
  ]);
  await registry.insertMissing([
    {
      provider: 'unconfigured',
      modelId: 'waiting-1',
      name: 'Waiting Model',
      category: 'text',
      contextWindow: 8_000,
      maxOutputTokens: 1_000,
      supportsStreaming: true,
      supportsVision: false,
      supportsTools: false,
      availability: 'paid',
      enabled: true,
      sortOrder: 500,
      inputPricePerMillionUsd: 1,
      outputPricePerMillionUsd: 4,
      verifiedAt: null,
    },
  ]);
  // The first registry read inserts the catalog defaults (here: the scripted model).
  await context.app.inject({ method: 'GET', url: '/api/models/catalog' });
  ctx = { ...context, registry };
  return ctx;
}

async function signIn(context: ChatTestContext, email: string, options: { admin?: boolean } = {}) {
  const app = context.app;
  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    headers: { origin: WEB_ORIGIN },
    payload: { email, password: 'a long enough password' },
  });
  if (options.admin) await context.repositories.users.setRoleByEmail(email, 'ADMIN');
  const verified = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    headers: { origin: WEB_ORIGIN },
    payload: { token: context.emails.tokenFor(email) },
  });
  return cookieValue(verified, SESSION)!;
}

function patch(context: ChatTestContext, registryId: string, payload: object, session?: string) {
  return context.app.inject({
    method: 'PATCH',
    url: `/api/admin/models/${registryId}`,
    headers: { origin: WEB_ORIGIN },
    payload,
    ...(session ? { cookies: { [SESSION]: session } } : {}),
  });
}

describe('public model endpoints', () => {
  it('GET /api/models lists only usable models with provider names', async () => {
    const context = await setup();
    const body = modelsResponseSchema.parse(
      (await context.app.inject({ method: 'GET', url: '/api/models' })).json(),
    );
    expect(body.models.map((model) => model.id)).toEqual(['fast-1']);
    expect(body.providers).toEqual(
      expect.arrayContaining([
        { id: 'scripted', name: 'scripted', configured: true },
        { id: 'unconfigured', name: 'unconfigured', configured: false },
      ]),
    );
  });

  it('GET /api/models/catalog shows every entry with its status, to anyone', async () => {
    const context = await setup();
    const body = modelCatalogResponseSchema.parse(
      (await context.app.inject({ method: 'GET', url: '/api/models/catalog' })).json(),
    );
    expect(body.models.map((model) => [model.id, model.status])).toEqual([
      ['fast-1', 'available'],
      ['waiting-1', 'provider_not_configured'],
    ]);
    expect(body.models[1]).toMatchObject({
      inputPricePerMillionUsd: 1,
      outputPricePerMillionUsd: 4,
      verifiedAt: null,
    });
  });

  it('includes the role in /api/me', async () => {
    const context = await setup();
    const admin = await signIn(context, 'admin@example.com', { admin: true });
    const me = meResponseSchema.parse(
      (
        await context.app.inject({ method: 'GET', url: '/api/me', cookies: { [SESSION]: admin } })
      ).json(),
    );
    expect(me.identity).toMatchObject({ kind: 'user', user: { role: 'admin' } });
  });
});

describe('admin model endpoints', () => {
  it('require an administrator', async () => {
    const context = await setup();
    const [entry] = context.registry.rows;
    const user = await signIn(context, 'user@example.com');

    const asGuest = await context.app.inject({ method: 'GET', url: '/api/admin/models' });
    expect(asGuest.statusCode).toBe(401);

    const asUser = await context.app.inject({
      method: 'GET',
      url: '/api/admin/models',
      cookies: { [SESSION]: user },
    });
    expect(asUser.statusCode).toBe(403);
    expect(asUser.json().error.code).toBe('FORBIDDEN');

    expect((await patch(context, entry!.id, { enabled: false }, user)).statusCode).toBe(403);
    expect(context.registry.rows[0]?.enabled).toBe(true);
  });

  it('let an admin disable a model, which chat then refuses, and re-enable it', async () => {
    const context = await setup();
    const admin = await signIn(context, 'admin@example.com', { admin: true });
    const entry = context.registry.rows.find((row) => row.modelId === 'fast-1')!;

    const disabled = await patch(context, entry.id, { enabled: false }, admin);
    expect(disabled.statusCode).toBe(200);
    expect(modelUpdateResponseSchema.parse(disabled.json()).model).toMatchObject({
      enabled: false,
      status: 'disabled',
    });

    const models = modelsResponseSchema.parse(
      (await context.app.inject({ method: 'GET', url: '/api/models' })).json(),
    );
    expect(models.models).toEqual([]);
    expect(models.defaultModel).toBeNull();

    const chat = await context.app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: WEB_ORIGIN },
      cookies: { [SESSION]: admin },
      payload: { provider: 'scripted', model: 'fast-1', message: 'hello' },
    });
    expect(chat.statusCode).toBe(400);
    expect(chat.json().error.code).toBe('MODEL_UNAVAILABLE');

    expect((await patch(context, entry.id, { enabled: true }, admin)).statusCode).toBe(200);
    const again = await context.app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: WEB_ORIGIN },
      cookies: { [SESSION]: admin },
      payload: { provider: 'scripted', model: 'fast-1', message: 'hello' },
    });
    expect(again.statusCode).toBe(200);
  });

  it('edit prices, limits and verification', async () => {
    const context = await setup();
    const admin = await signIn(context, 'admin@example.com', { admin: true });
    const entry = context.registry.rows.find((row) => row.modelId === 'fast-1')!;

    const response = await patch(
      context,
      entry.id,
      {
        name: 'Fast One',
        inputPricePerMillionUsd: 0.2,
        outputPricePerMillionUsd: null,
        contextWindow: 64_000,
        verified: true,
      },
      admin,
    );
    const { model } = modelUpdateResponseSchema.parse(response.json());
    expect(model).toMatchObject({
      name: 'Fast One',
      inputPricePerMillionUsd: 0.2,
      outputPricePerMillionUsd: null,
      contextWindow: 64_000,
    });
    expect(model.verifiedAt).toEqual(expect.any(String));
  });

  it('validate changes and ids', async () => {
    const context = await setup();
    const admin = await signIn(context, 'admin@example.com', { admin: true });
    const entry = context.registry.rows[0]!;

    const unknownField = await patch(context, entry.id, { provider: 'evil' }, admin);
    expect(unknownField.statusCode).toBe(400);
    expect(unknownField.json().error.code).toBe('VALIDATION_ERROR');

    expect((await patch(context, entry.id, {}, admin)).statusCode).toBe(400);
    expect(
      (await patch(context, entry.id, { maxOutputTokens: entry.contextWindow }, admin)).statusCode,
    ).toBe(400);
    expect((await patch(context, 'not-a-uuid', { enabled: false }, admin)).statusCode).toBe(404);
    expect((await patch(context, randomUUID(), { enabled: false }, admin)).statusCode).toBe(404);
  });

  it('block cross-site changes', async () => {
    const context = await setup();
    const admin = await signIn(context, 'admin@example.com', { admin: true });
    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/admin/models/${context.registry.rows[0]!.id}`,
      headers: { origin: 'https://evil.example' },
      cookies: { [SESSION]: admin },
      payload: { enabled: false },
    });
    expect(response.statusCode).toBe(403);
    expect(context.registry.rows[0]?.enabled).toBe(true);
  });
});
