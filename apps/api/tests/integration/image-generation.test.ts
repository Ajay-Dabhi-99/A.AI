import { AIProviderError } from '@a-ai/ai-core';
import { imageGenerationStatusSchema, imageJobResponseSchema } from '@a-ai/validation';
import { afterEach, describe, expect, it } from 'vitest';
import { contains, png, svg } from '../helpers/images.js';
import { ScriptedImageProvider } from '../helpers/image-provider.js';
import {
  createMemoryGenerationJobs,
  createMemoryStorage,
  type MemoryGenerationJobs,
  type MemoryStorage,
} from '../helpers/memory-attachments.js';
import {
  buildAuthTestApp,
  cookieValue,
  WEB_ORIGIN,
  type AuthTestContext,
} from '../helpers/test-app.js';

const SESSION = 'a_ai_session';
type Context = AuthTestContext & { storage: MemoryStorage; jobs: MemoryGenerationJobs };

let ctx: Context | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

async function setup(provider?: ScriptedImageProvider): Promise<Context> {
  const storage = createMemoryStorage();
  const jobs = createMemoryGenerationJobs();
  const context = await buildAuthTestApp({
    services: {
      storage,
      generationJobs: jobs,
      ...(provider ? { imageProviders: [provider] } : {}),
    },
  });
  ctx = { ...context, storage, jobs };
  return ctx;
}

async function signIn(context: Context, email = 'person@example.com') {
  await context.app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    headers: { origin: WEB_ORIGIN },
    payload: { firstName: 'Ada', lastName: 'Lovelace', email, password: 'a long enough password' },
  });
  const verified = await context.app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    headers: { origin: WEB_ORIGIN },
    payload: { token: context.emails.tokenFor(email) },
  });
  return { [SESSION]: cookieValue(verified, SESSION)! };
}

function generate(context: Context, cookies: Record<string, string> | undefined, payload: object) {
  return context.app.inject({
    method: 'POST',
    url: '/api/image/generate',
    headers: { origin: WEB_ORIGIN },
    ...(cookies ? { cookies } : {}),
    payload: { provider: 'pixels', model: 'pix-1', prompt: 'a red fox', ...payload },
  });
}

async function job(context: Context, cookies: Record<string, string>, id: string) {
  const response = await context.app.inject({ method: 'GET', url: `/api/image/${id}`, cookies });
  return { statusCode: response.statusCode, body: response.json() };
}

describe('image generation jobs (ADR-015 §6)', () => {
  it('is off, and says so, when no image provider is registered', async () => {
    const context = await setup();
    const status = await context.app.inject({ method: 'GET', url: '/api/image/status' });
    expect(imageGenerationStatusSchema.parse(status.json())).toEqual({
      enabled: false,
      models: [],
    });

    const cookies = await signIn(context);
    const response = await generate(context, cookies, {});
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      message: 'Image generation is not enabled on this deployment.',
    });
    expect(context.jobs.data).toHaveLength(0);

    expect((await generate(context, undefined, {})).statusCode).toBe(401);
  });

  it('runs a job to a verified, stored image that only its owner can read', async () => {
    const provider = new ScriptedImageProvider(async () => ({
      mimeType: 'image/png',
      data: png(256, 256, { text: 'generator metadata' }),
    }));
    const context = await setup(provider);
    const status = imageGenerationStatusSchema.parse(
      (await context.app.inject({ method: 'GET', url: '/api/image/status' })).json(),
    );
    expect(status).toEqual({
      enabled: true,
      models: [{ provider: 'pixels', model: 'pix-1', name: 'Pixels 1' }],
    });

    const cookies = await signIn(context);
    const started = await generate(context, cookies, { prompt: '  a red fox  ' });
    expect(started.statusCode).toBe(202);
    const queued = imageJobResponseSchema.parse(started.json()).job;
    expect(queued).toMatchObject({ status: 'queued', prompt: 'a red fox', attachment: null });

    await context.app.services.jobs.idle();
    const finished = await job(context, cookies, queued.id);
    const completed = imageJobResponseSchema.parse(finished.body).job;
    expect(completed.status).toBe('completed');
    expect(completed.attachment).toMatchObject({ source: 'generated', width: 256, height: 256 });
    expect(provider.requests[0]?.prompt).toBe('a red fox');

    const [object] = [...context.storage.objects.values()];
    expect(contains(object!.bytes, 'generator metadata')).toBe(false);

    const other = await signIn(context, 'other@example.com');
    expect((await job(context, other, queued.id)).statusCode).toBe(404);
    expect((await job(context, cookies, 'not-a-uuid')).statusCode).toBe(404);

    const unknownModel = await generate(context, cookies, { model: 'pix-9' });
    expect(unknownModel.statusCode).toBe(503);
    expect(unknownModel.json().error.message).toBe('This image model is not available.');
  });

  it('records provider failures and unusable output as failed jobs', async () => {
    let call = 0;
    const provider = new ScriptedImageProvider(async () => {
      call += 1;
      if (call === 1) {
        throw new AIProviderError({
          provider: 'pixels',
          code: 'PROVIDER_TIMEOUT',
          message: 'Pixels timed out',
        });
      }
      return { mimeType: 'image/png', data: svg() };
    });
    const context = await setup(provider);
    const cookies = await signIn(context);

    const timedOut = imageJobResponseSchema.parse(
      (await generate(context, cookies, {})).json(),
    ).job;
    await context.app.services.jobs.idle();
    const disguised = imageJobResponseSchema.parse(
      (await generate(context, cookies, {})).json(),
    ).job;
    await context.app.services.jobs.idle();

    expect(
      imageJobResponseSchema.parse((await job(context, cookies, timedOut.id)).body).job,
    ).toMatchObject({ status: 'failed', errorCode: 'PROVIDER_TIMEOUT', attachment: null });
    expect(
      imageJobResponseSchema.parse((await job(context, cookies, disguised.id)).body).job,
    ).toMatchObject({ status: 'failed', errorCode: 'VALIDATION_ERROR' });
    expect(context.storage.objects.size).toBe(0);
  });

  it('limits jobs per user per day', async () => {
    const provider = new ScriptedImageProvider(async () => ({
      mimeType: 'image/png',
      data: png(),
    }));
    const storage = createMemoryStorage();
    const context = await buildAuthTestApp({
      services: {
        storage,
        generationJobs: createMemoryGenerationJobs(),
        imageProviders: [provider],
        rateLimits: { imageByUser: { name: 'image-user', limit: 1, windowMs: 60_000 } },
      },
    });
    ctx = { ...context, storage, jobs: createMemoryGenerationJobs() };
    const cookies = await signIn(ctx);
    expect((await generate(ctx, cookies, {})).statusCode).toBe(202);
    const limited = await generate(ctx, cookies, {});
    expect(limited.statusCode).toBe(429);
    await context.app.services.jobs.idle();
  });
});
