import type { JobStreamEvent } from '@a-ai/shared-types';
import {
  mediaGenerationStatusSchema,
  mediaJobListResponseSchema,
  mediaJobResponseSchema,
  parseJobStreamEvent,
} from '@a-ai/validation';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEUED_RECOVERY_AGE_MS } from '../../src/modules/jobs/media-job.service.js';
import type { ServiceOverrides } from '../../src/services/container.js';
import { ScriptedVideoProvider } from '../helpers/image-provider.js';
import { mp4 } from '../helpers/media.js';
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
type Cookies = Record<string, string>;
type Context = AuthTestContext & { storage: MemoryStorage; jobs: MemoryGenerationJobs };

const contexts: Context[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.app.close()));
});

async function setup(
  services: ServiceOverrides = {},
  shared: { storage?: MemoryStorage; jobs?: MemoryGenerationJobs } = {},
): Promise<Context> {
  const storage = shared.storage ?? createMemoryStorage();
  const jobs = shared.jobs ?? createMemoryGenerationJobs();
  const context = await buildAuthTestApp({
    services: { storage, generationJobs: jobs, jobStreamPollMs: 10, ...services },
  });
  const ctx = { ...context, storage, jobs };
  contexts.push(ctx);
  return ctx;
}

async function signIn(context: Context, email = 'person@example.com'): Promise<Cookies> {
  await context.app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    headers: { origin: WEB_ORIGIN },
    payload: { email, password: 'a long enough password' },
  });
  const verified = await context.app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    headers: { origin: WEB_ORIGIN },
    payload: { token: context.emails.tokenFor(email) },
  });
  return { [SESSION]: cookieValue(verified, SESSION)! };
}

const generate = (context: Context, cookies: Cookies) =>
  context.app.inject({
    method: 'POST',
    url: '/api/video/generate',
    headers: { origin: WEB_ORIGIN },
    cookies,
    payload: { provider: 'reels', model: 'reel-1', prompt: 'a paper boat on a river' },
  });

function streamEvents(response: LightMyRequestResponse): JobStreamEvent[] {
  return response.body
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
      return event && data ? parseJobStreamEvent(event, data) : null;
    })
    .filter((event): event is JobStreamEvent => event !== null);
}

const events = (context: Context, cookies: Cookies, id: string) =>
  context.app.inject({ method: 'GET', url: `/api/jobs/${id}/events`, cookies });

describe('video jobs (Phase 9 gate: long jobs survive refresh and reconnect)', () => {
  it('is off, and says so, while no video provider is registered', async () => {
    const context = await setup();
    const status = await context.app.inject({ method: 'GET', url: '/api/video/status' });
    expect(mediaGenerationStatusSchema.parse(status.json())).toEqual({
      enabled: false,
      models: [],
    });

    const cookies = await signIn(context);
    const response = await generate(context, cookies);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.message).toBe(
      'Video generation is not enabled on this deployment.',
    );
    expect(context.jobs.data).toHaveLength(0);
  });

  it('streams progress snapshots until the job ends, and replays the end on reconnect', async () => {
    const provider = new ScriptedVideoProvider(async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      request.onProgress?.(0.5);
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { mimeType: 'video/mp4', data: mp4('isom') };
    });
    const context = await setup({ videoProviders: [provider] });
    const cookies = await signIn(context);

    const started = await generate(context, cookies);
    expect(started.statusCode).toBe(202);
    const { job } = mediaJobResponseSchema.parse(started.json());
    expect(job).toMatchObject({ kind: 'video', status: 'queued' });

    const live = await events(context, cookies, job.id);
    expect(live.headers['content-type']).toContain('text/event-stream');
    const snapshots = streamEvents(live).map((event) => event.data);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots.some((item) => item.status === 'processing' && item.progress === 0.5)).toBe(
      true,
    );
    const last = snapshots.at(-1)!;
    expect(last).toMatchObject({ status: 'completed', progress: 1 });
    expect(last.attachment).toMatchObject({ kind: 'video', mimeType: 'video/mp4' });

    // A refresh or reconnect after the job ended gets the final snapshot and a closed stream.
    const replay = streamEvents(await events(context, cookies, job.id));
    expect(replay).toHaveLength(1);
    expect(replay[0]?.data).toEqual(last);

    const listed = mediaJobListResponseSchema.parse(
      (await context.app.inject({ method: 'GET', url: '/api/jobs?kind=video', cookies })).json(),
    );
    expect(listed.jobs.map((item) => item.id)).toEqual([job.id]);
    const byId = await context.app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, cookies });
    expect(mediaJobResponseSchema.parse(byId.json()).job).toEqual(last);
    expect(
      (await context.app.inject({ method: 'GET', url: `/api/video/${job.id}`, cookies }))
        .statusCode,
    ).toBe(200);
    // A video job is not an image job.
    expect(
      (await context.app.inject({ method: 'GET', url: `/api/image/${job.id}`, cookies }))
        .statusCode,
    ).toBe(404);
  });

  it('keeps jobs private to their owner', async () => {
    const provider = new ScriptedVideoProvider(async () => ({
      mimeType: 'video/mp4',
      data: mp4('isom'),
    }));
    const context = await setup({ videoProviders: [provider] });
    const owner = await signIn(context, 'owner@example.com');
    const other = await signIn(context, 'other@example.com');
    const { job } = mediaJobResponseSchema.parse((await generate(context, owner)).json());
    await context.app.services.jobs.idle();

    for (const [method, url] of [
      ['GET', `/api/jobs/${job.id}`],
      ['GET', `/api/jobs/${job.id}/events`],
      ['POST', `/api/jobs/${job.id}/cancel`],
    ] as const) {
      const response = await context.app.inject({
        method,
        url,
        cookies: other,
        headers: { origin: WEB_ORIGIN },
      });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
    }
    const listed = mediaJobListResponseSchema.parse(
      (await context.app.inject({ method: 'GET', url: '/api/jobs', cookies: other })).json(),
    );
    expect(listed.jobs).toEqual([]);
    expect((await context.app.inject({ method: 'GET', url: '/api/jobs' })).statusCode).toBe(401);
  });

  it('cancels a running job and tells open streams', async () => {
    const provider = new ScriptedVideoProvider(
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(request.signal?.reason), {
            once: true,
          });
        }),
    );
    const context = await setup({ videoProviders: [provider] });
    const cookies = await signIn(context);
    const { job } = mediaJobResponseSchema.parse((await generate(context, cookies)).json());
    await vi.waitFor(() => expect(provider.requests).toHaveLength(1));

    const stream = events(context, cookies, job.id);
    const cancelled = await context.app.inject({
      method: 'POST',
      url: `/api/jobs/${job.id}/cancel`,
      headers: { origin: WEB_ORIGIN },
      cookies,
    });
    expect(mediaJobResponseSchema.parse(cancelled.json()).job.status).toBe('cancelled');
    expect(streamEvents(await stream).at(-1)?.data.status).toBe('cancelled');
    expect(provider.requests[0]?.signal?.aborted).toBe(true);
    expect(context.storage.objects.size).toBe(0);
  });

  it('picks up jobs a stopped instance left behind when the API starts', async () => {
    const storage = createMemoryStorage();
    const jobs = createMemoryGenerationJobs();
    const provider = new ScriptedVideoProvider(async () => ({
      mimeType: 'video/mp4',
      data: mp4('isom'),
    }));

    // What a crashed instance leaves: a job queued a while ago that nothing is running.
    const orphaned = await jobs.create({
      userId: 'user-from-before',
      kind: 'video',
      provider: 'reels',
      model: 'reel-1',
      prompt: 'a paper boat',
    });
    const context = await setup({ videoProviders: [provider] }, { storage, jobs });
    jobs.data[0]!.createdAt = new Date(
      context.clock.now().getTime() - QUEUED_RECOVERY_AGE_MS - 1_000,
    );

    await context.app.ready();
    await vi.waitFor(() =>
      expect(jobs.data.find((job) => job.id === orphaned.id)?.status).toBe('COMPLETED'),
    );
    expect(storage.objects.size).toBe(1);
  });
});
