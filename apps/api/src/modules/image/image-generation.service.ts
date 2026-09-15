import { isAIProviderError, type ImageGenerationProvider, type ImageModel } from '@a-ai/ai-core';
import type {
  Attachment,
  ImageGenerationStatus,
  ImageJob,
  ImageJobResponse,
} from '@a-ai/shared-types';
import type { ImageGenerateRequest } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import type {
  GenerationJobRecord,
  GenerationJobRepository,
} from '../../repositories/generation-job.repository.js';
import type { KeyValueStore } from '../../services/kv-store.js';
import type { RateLimiter, RateLimitRule } from '../../services/rate-limit.service.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { AttachmentService } from '../attachments/attachment.service.js';

/** Longest one generation may take before the job fails with PROVIDER_TIMEOUT. */
export const IMAGE_JOB_TIMEOUT_MS = 120_000;
/** How long the Redis progress mirror outlives the last change. */
export const JOB_MIRROR_TTL_MS = 60 * 60 * 1000;

export type ImageGenerationServiceDeps = {
  /** Empty in this phase: no image provider is enabled (ADR-015 §6). */
  providers: ImageGenerationProvider[];
  jobs: GenerationJobRepository;
  attachments: AttachmentService;
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

/**
 * Image generation as an asynchronous job (blueprint §12, ADR-015 §6). The
 * database row is the source of truth; progress is mirrored in Redis. With no
 * provider configured, nothing is advertised and no job is created.
 */
export class ImageGenerationService {
  readonly #deps: ImageGenerationServiceDeps;
  readonly #pending = new Set<Promise<void>>();

  constructor(deps: ImageGenerationServiceDeps) {
    this.#deps = deps;
  }

  get enabled(): boolean {
    return this.#deps.providers.length > 0 && this.#deps.attachments.enabled;
  }

  status(): ImageGenerationStatus {
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

  async start(userId: string, input: ImageGenerateRequest): Promise<ImageJobResponse> {
    if (!this.enabled) {
      throw new AppError(
        'MODEL_UNAVAILABLE',
        'Image generation is not enabled on this deployment.',
        {
          retryable: false,
        },
      );
    }
    const match = this.#find(input.provider, input.model);
    if (!match) {
      throw new AppError('MODEL_UNAVAILABLE', 'This image model is not available.', {
        retryable: false,
      });
    }
    await this.#deps.rateLimiter.consume(this.#deps.rule, `user:${userId}`);

    const job = await this.#deps.jobs.create({
      userId,
      provider: match.model.provider,
      model: match.model.id,
      prompt: input.prompt,
    });
    await this.#mirror(job.id, 'queued');
    this.#deps.logger.info(
      {
        event: 'image.job.queued',
        userId,
        jobId: job.id,
        provider: job.provider,
        model: job.model,
      },
      'image job queued',
    );
    this.#track(this.#run(job, match.provider));
    return { job: toImageJob(job, null) };
  }

  async get(userId: string, jobId: string): Promise<ImageJobResponse> {
    const job = await this.#deps.jobs.findForUser(jobId, userId);
    if (!job) throw new AppError('NOT_FOUND', 'This image job does not exist.');
    const attachment = job.attachmentId
      ? await this.#deps.attachments.find(userId, job.attachmentId)
      : null;
    return { job: toImageJob(job, attachment) };
  }

  /** Resolves when every running job has finished (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  #find(providerId: string, modelId: string) {
    for (const provider of this.#deps.providers) {
      const model = provider
        .models()
        .find(
          (candidate: ImageModel) => candidate.provider === providerId && candidate.id === modelId,
        );
      if (model) return { provider, model };
    }
    return null;
  }

  #track(task: Promise<void>): void {
    this.#pending.add(task);
    const settle = () => {
      this.#pending.delete(task);
    };
    task.then(settle, settle);
  }

  async #mirror(jobId: string, status: ImageJob['status']): Promise<void> {
    await this.#deps.store
      .setJson(
        jobMirrorKey(jobId),
        { status, updatedAt: this.#deps.clock.now().toISOString() },
        JOB_MIRROR_TTL_MS,
      )
      .catch((error: unknown) => {
        this.#deps.logger.warn({ err: error, jobId }, 'job progress mirror unavailable');
      });
  }

  async #run(job: GenerationJobRecord, provider: ImageGenerationProvider): Promise<void> {
    const { jobs, attachments, clock, logger } = this.#deps;
    const log = { event: 'image.job', jobId: job.id, provider: job.provider, model: job.model };
    try {
      // Another instance may already run it; only the claimer continues.
      if (!(await jobs.claim(job.id, clock.now()))) return;
      await this.#mirror(job.id, 'processing');

      const generated = await provider.generate({
        model: job.model,
        prompt: job.prompt,
        signal: AbortSignal.timeout(this.#deps.timeoutMs ?? IMAGE_JOB_TIMEOUT_MS),
      });
      const attachment = await attachments.storeGenerated(job.userId, generated.data);
      await jobs.complete(job.id, attachment.id, clock.now());
      await this.#mirror(job.id, 'completed');
      logger.info(
        { ...log, outcome: 'completed', attachmentId: attachment.id },
        'image job completed',
      );
    } catch (error) {
      const code = isAIProviderError(error)
        ? error.code
        : error instanceof AppError
          ? error.code
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'PROVIDER_TIMEOUT'
            : 'INTERNAL_ERROR';
      logger[code === 'INTERNAL_ERROR' ? 'error' : 'warn'](
        { ...log, outcome: 'failed', code, err: error },
        'image job failed',
      );
      await jobs.fail(job.id, code, clock.now()).catch((failError: unknown) => {
        logger.error({ ...log, err: failError }, 'failed to record image job failure');
      });
      await this.#mirror(job.id, 'failed');
    }
  }
}

export function toImageJob(job: GenerationJobRecord, attachment: Attachment | null): ImageJob {
  return {
    id: job.id,
    status: job.status.toLowerCase() as ImageJob['status'],
    provider: job.provider,
    model: job.model,
    prompt: job.prompt,
    errorCode: job.errorCode,
    attachment,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}
