import { AIProviderError } from '@a-ai/ai-core';
import { describe, expect, it } from 'vitest';
import { AttachmentService } from '../../src/modules/attachments/attachment.service.js';
import {
  MediaJobService,
  PROCESSING_GRACE_MS,
  QUEUED_RECOVERY_AGE_MS,
} from '../../src/modules/jobs/media-job.service.js';
import { createRedisStore } from '../../src/services/kv-store.js';
import { RATE_LIMITS, RateLimiter } from '../../src/services/rate-limit.service.js';
import { silentLogger, TestClock } from '../helpers/fakes.js';
import { createMemoryConversations } from '../helpers/memory-conversations.js';
import { ScriptedVideoProvider } from '../helpers/image-provider.js';
import { png } from '../helpers/images.js';
import { mp4 } from '../helpers/media.js';
import {
  createMemoryAttachments,
  createMemoryGenerationJobs,
  createMemoryStorage,
} from '../helpers/memory-attachments.js';
import { controlledRedis } from '../helpers/test-app.js';

const USER = 'user-1';
const TIMEOUT_MS = 5_000;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Resolves when the request's signal aborts. */
const untilAborted = (signal: AbortSignal | undefined) =>
  new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

function setup(provider: ScriptedVideoProvider, options: { timeoutMs?: number } = {}) {
  const clock = new TestClock('2026-09-17T10:00:00.000Z');
  const store = createRedisStore(controlledRedis());
  const storage = createMemoryStorage();
  const attachmentRows = createMemoryAttachments();
  const jobs = createMemoryGenerationJobs(() => clock.now());
  const logger = silentLogger();
  const rateLimiter = new RateLimiter(store);
  const attachments = new AttachmentService({
    repository: attachmentRows,
    storage,
    rateLimiter,
    uploadRule: RATE_LIMITS.uploadByUser,
    maxBytes: 5_242_880,
    videoMaxBytes: 1_048_576,
    clock,
    logger,
  });
  const conversations = createMemoryConversations();
  const service = new MediaJobService({
    kind: 'video',
    providers: [provider],
    jobs,
    attachments,
    conversations,
    store,
    rateLimiter,
    rule: RATE_LIMITS.videoByUser,
    clock,
    logger,
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
  });
  return { clock, storage, attachmentRows, jobs, conversations, service };
}

const input = { provider: 'reels', model: 'reel-1', prompt: 'a paper boat on a river' };

describe('MediaJobService (video)', () => {
  it('reports progress while processing and stores a verified video', async () => {
    const release = deferred();
    const provider = new ScriptedVideoProvider(async (request) => {
      request.onProgress?.(0.42);
      await release.promise;
      return { mimeType: 'video/mp4', data: mp4('isom') };
    });
    const { service, storage } = setup(provider);

    const { job } = await service.start(USER, input);
    expect(job).toMatchObject({ kind: 'video', status: 'queued', progress: null });

    await expect.poll(async () => (await service.get(USER, job.id)).job.progress).toBe(0.42);
    expect((await service.get(USER, job.id)).job.status).toBe('processing');

    release.resolve();
    await service.idle();
    const done = (await service.get(USER, job.id)).job;
    expect(done).toMatchObject({ status: 'completed', progress: 1 });
    expect(done.attachment).toMatchObject({
      kind: 'video',
      mimeType: 'video/mp4',
      width: null,
      height: null,
      source: 'generated',
    });
    expect(storage.objects.size).toBe(1);
  });

  it('creates a job inside a chat, starting one named after the prompt when asked', async () => {
    const provider = new ScriptedVideoProvider(async () => ({
      mimeType: 'video/mp4',
      data: mp4('isom'),
    }));
    const { service, conversations, clock } = setup(provider);

    const first = (await service.start(USER, { ...input, conversationId: 'new' })).job;
    const chat = conversations.data.conversations[0];
    expect(chat).toMatchObject({ userId: USER, title: input.prompt });
    expect(first.conversationId).toBe(chat?.id);

    clock.advance(60_000);
    const second = (await service.start(USER, { ...input, conversationId: chat!.id })).job;
    expect(second.conversationId).toBe(chat?.id);
    expect(conversations.data.conversations).toHaveLength(1);
    expect(conversations.data.conversations[0]?.updatedAt.toISOString()).toBe(
      '2026-09-17T10:01:00.000Z',
    );

    const outside = (await service.start(USER, input)).job;
    expect(outside.conversationId).toBeNull();

    await service.idle();
    expect((await service.listForConversation(USER, chat!.id)).map((job) => job.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(await service.listForConversation('someone-else', chat!.id)).toEqual([]);
  });

  it("refuses another user's chat without creating anything", async () => {
    const provider = new ScriptedVideoProvider(async () => ({
      mimeType: 'video/mp4',
      data: mp4('isom'),
    }));
    const { service, conversations, jobs } = setup(provider);
    const theirs = await conversations.create({ userId: 'someone-else', title: 'Theirs' });

    await expect(
      service.start(USER, { ...input, conversationId: theirs.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(jobs.data).toHaveLength(0);
  });

  it('fails a job whose output is not a video, or is too large', async () => {
    let call = 0;
    const provider = new ScriptedVideoProvider(async () => {
      call += 1;
      return call === 1
        ? { mimeType: 'video/mp4', data: png() }
        : { mimeType: 'video/mp4', data: mp4('isom', 2_000_000) };
    });
    const { service, storage } = setup(provider);

    const notVideo = (await service.start(USER, input)).job;
    await service.idle();
    const tooLarge = (await service.start(USER, input)).job;
    await service.idle();

    expect((await service.get(USER, notVideo.id)).job).toMatchObject({
      status: 'failed',
      errorCode: 'VALIDATION_ERROR',
    });
    expect((await service.get(USER, tooLarge.id)).job.status).toBe('failed');
    expect(storage.objects.size).toBe(0);
  });

  it('stops the provider call when the owner cancels', async () => {
    const provider = new ScriptedVideoProvider((request) => untilAborted(request.signal));
    const { service, storage } = setup(provider);
    const { job } = await service.start(USER, input);
    await expect.poll(async () => (await service.get(USER, job.id)).job.status).toBe('processing');

    const cancelled = await service.cancel(USER, job.id);
    await service.idle();
    expect(cancelled.job.status).toBe('cancelled');
    expect(provider.requests[0]?.signal?.aborted).toBe(true);
    expect((await service.get(USER, job.id)).job.status).toBe('cancelled');
    // Cancelling again changes nothing.
    expect((await service.cancel(USER, job.id)).job.status).toBe('cancelled');
    expect(storage.objects.size).toBe(0);
    await expect(service.cancel('someone-else', job.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('discards the stored file when the job was cancelled while storing', async () => {
    const provider = new ScriptedVideoProvider(async () => ({
      mimeType: 'video/mp4',
      data: mp4('isom'),
    }));
    const { service, jobs, storage, attachmentRows } = setup(provider);
    const complete = jobs.complete.bind(jobs);
    jobs.complete = async (id, attachmentId, at) => {
      await jobs.cancel(id, USER, at);
      return complete(id, attachmentId, at);
    };

    const { job } = await service.start(USER, input);
    await service.idle();
    expect((await service.get(USER, job.id)).job).toMatchObject({
      status: 'cancelled',
      attachment: null,
    });
    expect(storage.objects.size).toBe(0);
    expect(attachmentRows.data).toHaveLength(0);
  });

  it('fails with PROVIDER_TIMEOUT when generation takes too long', async () => {
    const provider = new ScriptedVideoProvider((request) => untilAborted(request.signal));
    const { service } = setup(provider, { timeoutMs: 20 });
    const { job } = await service.start(USER, input);
    await service.idle();
    expect((await service.get(USER, job.id)).job).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_TIMEOUT',
    });
  });

  it('records provider errors with their code', async () => {
    const provider = new ScriptedVideoProvider(async () => {
      throw new AIProviderError({ provider: 'reels', code: 'RATE_LIMITED', message: 'Reels 429' });
    });
    const { service } = setup(provider);
    const { job } = await service.start(USER, input);
    await service.idle();
    expect((await service.get(USER, job.id)).job.errorCode).toBe('RATE_LIMITED');
  });
});

describe('MediaJobService.recover (API restart)', () => {
  it('fails interrupted jobs, restarts queued ones and leaves fresh ones alone', async () => {
    const provider = new ScriptedVideoProvider(async () => ({
      mimeType: 'video/mp4',
      data: mp4('isom'),
    }));
    const { service, jobs, clock } = setup(provider);
    const now = clock.now().getTime();

    const interrupted = await jobs.create({ userId: USER, kind: 'video', ...input });
    await jobs.claim(interrupted.id, new Date(now - TIMEOUT_MS - PROCESSING_GRACE_MS - 1));
    const orphaned = await jobs.create({ userId: USER, kind: 'video', ...input });
    Object.assign(
      jobs.data.find((job) => job.id === orphaned.id)!,
      {
        createdAt: new Date(now - QUEUED_RECOVERY_AGE_MS - 1),
      },
    );
    const unknownModel = await jobs.create({
      userId: USER,
      kind: 'video',
      ...input,
      model: 'retired-model',
    });
    Object.assign(
      jobs.data.find((job) => job.id === unknownModel.id)!,
      {
        createdAt: new Date(now - QUEUED_RECOVERY_AGE_MS - 1),
      },
    );
    const fresh = await jobs.create({ userId: USER, kind: 'video', ...input });
    const recentlyStarted = await jobs.create({ userId: USER, kind: 'video', ...input });
    await jobs.claim(recentlyStarted.id, new Date(now - 1_000));

    expect(await service.recover()).toEqual({ interrupted: 2, resumed: 1 });
    await service.idle();

    const status = async (id: string) => (await service.get(USER, id)).job;
    expect(await status(interrupted.id)).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_TIMEOUT',
    });
    expect(await status(orphaned.id)).toMatchObject({ status: 'completed' });
    expect(await status(unknownModel.id)).toMatchObject({
      status: 'failed',
      errorCode: 'MODEL_UNAVAILABLE',
    });
    expect((await status(fresh.id)).status).toBe('queued');
    expect((await status(recentlyStarted.id)).status).toBe('processing');
    expect(provider.requests).toHaveLength(1);
  });
});
