import { isAIProviderError, type MediaGenerationProvider } from '@a-ai/ai-core';
import {
  isTerminalJobStatus,
  type Attachment,
  type MediaGenerationStatus,
  type MediaJob,
  type MediaJobKind,
  type MediaJobListResponse,
  type MediaJobResponse,
} from '@a-ai/shared-types';
import type { MediaGenerateRequest } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import type {
  GenerationJobRecord,
  GenerationJobRepository,
} from '../../repositories/generation-job.repository.js';
import type { KeyValueStore } from '../../services/kv-store.js';
import type { RateLimiter, RateLimitRule } from '../../services/rate-limit.service.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { ConversationRepository } from '../../repositories/conversation.repository.js';
import type { AttachmentService } from '../attachments/attachment.service.js';
import { conversationTitle } from '../chat/mappers.js';

/** Longest one generation may take before the job fails with PROVIDER_TIMEOUT. */
export const MEDIA_JOB_TIMEOUT_MS: Readonly<Record<MediaJobKind, number>> = {
  image: 120_000,
  video: 15 * 60_000,
};
/** How long the Redis progress mirror outlives the last change. */
export const JOB_MIRROR_TTL_MS = 60 * 60 * 1000;
/** A queued job this old was never started (its instance stopped) and is started again. */
export const QUEUED_RECOVERY_AGE_MS = 60_000;
/** A processing job this long past its timeout was interrupted and is failed. */
export const PROCESSING_GRACE_MS = 60_000;
/** Progress changes smaller than this are not written to Redis. */
const PROGRESS_STEP = 0.01;

const LABELS: Readonly<Record<MediaJobKind, string>> = {
  image: 'Image generation',
  video: 'Video generation',
};

type Mirror = { status: MediaJob['status']; progress: number | null; updatedAt: string };

export type MediaJobServiceDeps = {
  kind: MediaJobKind;
  /** Empty until a provider with quota is registered (ADR-015 §6, ADR-016). */
  providers: MediaGenerationProvider[];
  jobs: GenerationJobRepository;
  attachments: Pick<AttachmentService, 'enabled' | 'find' | 'storeGenerated' | 'discard'>;
  /** Chats a job can be created in (MODEL-065). */
  conversations: Pick<ConversationRepository, 'findForUser' | 'create' | 'touch'>;
  store: KeyValueStore;
  rateLimiter: RateLimiter;
  rule: RateLimitRule;
  clock: Clock;
  logger: FastifyBaseLogger;
  timeoutMs?: number;
};

export function jobMirrorKey(jobId: string): string {
  return `job:${jobId}`;
}

export function toMediaJob(
  job: GenerationJobRecord,
  attachment: Attachment | null,
  progress: number | null,
): MediaJob {
  return {
    id: job.id,
    kind: job.kind === 'video' ? 'video' : 'image',
    status: job.status.toLowerCase() as MediaJob['status'],
    provider: job.provider,
    model: job.model,
    prompt: job.prompt,
    progress,
    errorCode: job.errorCode,
    attachment,
    conversationId: job.conversationId,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

/**
 * One kind of media generation as an asynchronous job (blueprint §12, ADR-016).
 * The database row is the source of truth; progress is mirrored in Redis. Jobs
 * survive a browser refresh (they are addressed by id) and an API restart
 * (`recover` fails interrupted jobs and starts queued ones again). With no
 * provider configured nothing is advertised and no job is created.
 */
export class MediaJobService {
  readonly #deps: MediaJobServiceDeps;
  readonly #pending = new Set<Promise<void>>();
  /** Jobs this instance is running, so a cancel can stop the provider call. */
  readonly #running = new Map<string, AbortController>();

  constructor(deps: MediaJobServiceDeps) {
    this.#deps = deps;
  }

  get kind(): MediaJobKind {
    return this.#deps.kind;
  }

  get enabled(): boolean {
    return this.#deps.providers.length > 0 && this.#deps.attachments.enabled;
  }

  get #timeoutMs(): number {
    return this.#deps.timeoutMs ?? MEDIA_JOB_TIMEOUT_MS[this.#deps.kind];
  }

  status(): MediaGenerationStatus {
    if (!this.enabled) return { enabled: false, models: [] };
    return {
      enabled: true,
      models: this.#deps.providers.flatMap((provider) =>
        provider.models().map((model) => ({
          provider: model.provider,
          model: model.id,
          name: model.name,
        })),
      ),
    };
  }

  async start(userId: string, input: MediaGenerateRequest): Promise<MediaJobResponse> {
    const { kind } = this.#deps;
    if (!this.enabled) {
      throw new AppError(
        'MODEL_UNAVAILABLE',
        `${LABELS[kind]} is not enabled on this deployment.`,
        {
          retryable: false,
        },
      );
    }
    const provider = this.#find(input.provider, input.model);
    if (!provider) {
      throw new AppError('MODEL_UNAVAILABLE', `This ${kind} model is not available.`, {
        retryable: false,
      });
    }
    const { conversations, clock } = this.#deps;
    const existing =
      input.conversationId && input.conversationId !== 'new'
        ? await conversations.findForUser(input.conversationId, userId)
        : null;
    if (input.conversationId && input.conversationId !== 'new' && !existing) {
      throw new AppError('NOT_FOUND', 'This conversation does not exist.');
    }
    await this.#deps.rateLimiter.consume(this.#deps.rule, `user:${userId}`);

    // `new` starts a chat named after the prompt, as a first chat message would.
    const conversation =
      input.conversationId === 'new'
        ? await conversations.create({ userId, title: conversationTitle(input.prompt) })
        : existing;
    const job = await this.#deps.jobs.create({
      userId,
      kind,
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      conversationId: conversation?.id ?? null,
    });
    if (conversation) await conversations.touch(conversation.id, clock.now());
    await this.#mirror(job.id, 'queued', null);
    this.#deps.logger.info(
      {
        event: 'media.job.queued',
        kind,
        userId,
        jobId: job.id,
        provider: job.provider,
        model: job.model,
      },
      'media job queued',
    );
    this.#track(this.#run(job, provider));
    return { job: toMediaJob(job, null, null) };
  }

  async get(userId: string, jobId: string): Promise<MediaJobResponse> {
    const job = await this.#deps.jobs.findForUser(jobId, userId);
    if (!job || job.kind !== this.#deps.kind) {
      throw new AppError('NOT_FOUND', `This ${this.#deps.kind} job does not exist.`);
    }
    return { job: await this.describe(job) };
  }

  async list(userId: string, limit: number): Promise<MediaJobListResponse> {
    const jobs = await this.#deps.jobs.listForUser(userId, this.#deps.kind, limit);
    return { jobs: await Promise.all(jobs.map((job) => this.describe(job))) };
  }

  /** Jobs of this kind started from one chat, oldest first. */
  async listForConversation(userId: string, conversationId: string): Promise<MediaJob[]> {
    const jobs = await this.#deps.jobs.listForConversation(conversationId, userId);
    return Promise.all(
      jobs.filter((job) => job.kind === this.#deps.kind).map((job) => this.describe(job)),
    );
  }

  /** Idempotent: cancelling an ended job returns it unchanged. */
  async cancel(userId: string, jobId: string): Promise<MediaJobResponse> {
    const { jobs, clock, logger, kind } = this.#deps;
    const job = await jobs.findForUser(jobId, userId);
    if (!job || job.kind !== kind) {
      throw new AppError('NOT_FOUND', `This ${kind} job does not exist.`);
    }
    if (await jobs.cancel(jobId, userId, clock.now())) {
      this.#running.get(jobId)?.abort(new DOMException('The job was cancelled', 'AbortError'));
      await this.#mirror(jobId, 'cancelled', null);
      logger.info({ event: 'media.job.cancelled', kind, userId, jobId }, 'media job cancelled');
    }
    return this.get(userId, jobId);
  }

  /** The client view of a job: its attachment, and live progress while processing. */
  async describe(job: GenerationJobRecord): Promise<MediaJob> {
    const attachment = job.attachmentId
      ? await this.#deps.attachments.find(job.userId, job.attachmentId)
      : null;
    let progress: number | null = job.status === 'COMPLETED' ? 1 : null;
    if (job.status === 'PROCESSING') {
      const mirror = await this.#deps.store
        .getJson<Partial<Mirror>>(jobMirrorKey(job.id))
        .catch(() => null);
      progress = typeof mirror?.progress === 'number' ? mirror.progress : null;
    }
    return toMediaJob(job, attachment, progress);
  }

  /**
   * Picks up after a stopped instance: processing jobs well past their timeout
   * fail with PROVIDER_TIMEOUT, and queued jobs that were never started run now
   * (the claim makes this safe with several instances). Never throws per job.
   */
  async recover(): Promise<{ interrupted: number; resumed: number }> {
    const { jobs, clock, logger, kind } = this.#deps;
    const now = clock.now().getTime();
    const stale = await jobs.listStale({
      kind,
      processingStartedBefore: new Date(now - this.#timeoutMs - PROCESSING_GRACE_MS),
      queuedCreatedBefore: new Date(now - QUEUED_RECOVERY_AGE_MS),
      limit: 100,
    });

    let interrupted = 0;
    let resumed = 0;
    for (const job of stale) {
      if (this.#running.has(job.id)) continue;
      const provider = job.status === 'QUEUED' ? this.#find(job.provider, job.model) : null;
      if (job.status === 'QUEUED' && provider && this.enabled) {
        this.#track(this.#run(job, provider));
        resumed += 1;
        continue;
      }
      const code = job.status === 'PROCESSING' ? 'PROVIDER_TIMEOUT' : 'MODEL_UNAVAILABLE';
      if (await jobs.fail(job.id, code, clock.now())) {
        await this.#mirror(job.id, 'failed', null);
        interrupted += 1;
      }
    }
    if (interrupted + resumed > 0) {
      logger.warn(
        { event: 'media.job.recovered', kind, interrupted, resumed },
        'media jobs recovered',
      );
    }
    return { interrupted, resumed };
  }

  /** Resolves when every running job has finished (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  #find(providerId: string, modelId: string): MediaGenerationProvider | null {
    return (
      this.#deps.providers.find(
        (provider) =>
          provider.id === providerId &&
          provider.models().some((model) => model.provider === providerId && model.id === modelId),
      ) ?? null
    );
  }

  #track(task: Promise<void>): void {
    this.#pending.add(task);
    const settle = () => {
      this.#pending.delete(task);
    };
    task.then(settle, settle);
  }

  async #mirror(jobId: string, status: MediaJob['status'], progress: number | null): Promise<void> {
    const mirror: Mirror = { status, progress, updatedAt: this.#deps.clock.now().toISOString() };
    await this.#deps.store
      .setJson(jobMirrorKey(jobId), mirror, JOB_MIRROR_TTL_MS)
      .catch((error: unknown) => {
        this.#deps.logger.warn({ err: error, jobId }, 'job progress mirror unavailable');
      });
  }

  async #run(job: GenerationJobRecord, provider: MediaGenerationProvider): Promise<void> {
    const { jobs, attachments, clock, logger, kind } = this.#deps;
    const log = {
      event: 'media.job',
      kind,
      jobId: job.id,
      provider: job.provider,
      model: job.model,
    };
    const cancel = new AbortController();
    const timeout = AbortSignal.timeout(this.#timeoutMs);

    try {
      // Another instance may already run it; only the claimer continues.
      if (!(await jobs.claim(job.id, clock.now()))) return;
      this.#running.set(job.id, cancel);
      await this.#mirror(job.id, 'processing', null);

      let reported = -1;
      const generated = await provider.generate({
        model: job.model,
        prompt: job.prompt,
        signal: AbortSignal.any([cancel.signal, timeout]),
        onProgress: (fraction) => {
          const progress = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
          if (progress - reported < PROGRESS_STEP) return;
          reported = progress;
          void this.#mirror(job.id, 'processing', Math.round(progress * 1000) / 1000);
        },
      });
      if (cancel.signal.aborted) return;

      const record = await attachments.storeGenerated(job.userId, generated.data, kind);
      if (!(await jobs.complete(job.id, record.id, clock.now()))) {
        // Cancelled while the file was being stored: the file is not wanted.
        await attachments.discard(record, 'job-ended-while-storing');
        return;
      }
      await this.#mirror(job.id, 'completed', 1);
      logger.info({ ...log, outcome: 'completed', attachmentId: record.id }, 'media job completed');
    } catch (error) {
      if (cancel.signal.aborted) {
        logger.info({ ...log, outcome: 'cancelled' }, 'media job stopped after cancel');
        return;
      }
      const code = timeout.aborted
        ? 'PROVIDER_TIMEOUT'
        : isAIProviderError(error)
          ? error.code
          : error instanceof AppError
            ? error.code
            : 'INTERNAL_ERROR';
      logger[code === 'INTERNAL_ERROR' ? 'error' : 'warn'](
        { ...log, outcome: 'failed', code, err: error },
        'media job failed',
      );
      const failed = await jobs.fail(job.id, code, clock.now()).catch((failError: unknown) => {
        logger.error({ ...log, err: failError }, 'failed to record media job failure');
        return false;
      });
      if (failed) await this.#mirror(job.id, 'failed', null);
    } finally {
      this.#running.delete(job.id);
    }
  }
}

export { isTerminalJobStatus };
