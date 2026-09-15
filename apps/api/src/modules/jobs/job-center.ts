import type { MediaJobKind, MediaJobListResponse, MediaJobResponse } from '@a-ai/shared-types';
import type { GenerationJobRepository } from '../../repositories/generation-job.repository.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { MediaJobService } from './media-job.service.js';

/** How often an open job event stream re-reads the job (ADR-016 §2). */
export const JOB_STREAM_POLL_MS = 1_000;
/** An event stream closes after this long; the client reconnects and gets a fresh snapshot. */
export const JOB_STREAM_MAX_MS = 10 * 60_000;
/** How often a running API instance looks for interrupted jobs. */
export const JOB_RECOVERY_INTERVAL_MS = 5 * 60_000;

const NOT_FOUND = 'This job does not exist.';

const isMediaKind = (kind: string): kind is MediaJobKind => kind === 'image' || kind === 'video';

/** Every kind of media job behind one id-addressed API (`/api/jobs`). */
export class JobCenter {
  readonly services: Readonly<Record<MediaJobKind, MediaJobService>>;
  readonly streamPollMs: number;
  readonly #jobs: GenerationJobRepository;

  constructor(options: {
    services: Record<MediaJobKind, MediaJobService>;
    jobs: GenerationJobRepository;
    streamPollMs?: number;
  }) {
    this.services = options.services;
    this.#jobs = options.jobs;
    this.streamPollMs = options.streamPollMs ?? JOB_STREAM_POLL_MS;
  }

  async get(userId: string, jobId: string): Promise<MediaJobResponse> {
    const job = await this.#jobs.findForUser(jobId, userId);
    if (!job || !isMediaKind(job.kind)) throw new AppError('NOT_FOUND', NOT_FOUND);
    return { job: await this.services[job.kind].describe(job) };
  }

  async cancel(userId: string, jobId: string): Promise<MediaJobResponse> {
    const job = await this.#jobs.findForUser(jobId, userId);
    if (!job || !isMediaKind(job.kind)) throw new AppError('NOT_FOUND', NOT_FOUND);
    return this.services[job.kind].cancel(userId, jobId);
  }

  async list(
    userId: string,
    kind: MediaJobKind | undefined,
    limit: number,
  ): Promise<MediaJobListResponse> {
    if (kind) return this.services[kind].list(userId, limit);
    const jobs = await this.#jobs.listForUser(userId, null, limit);
    return {
      jobs: await Promise.all(
        jobs
          .filter((job) => isMediaKind(job.kind))
          .map((job) => this.services[job.kind as MediaJobKind].describe(job)),
      ),
    };
  }

  async recover(): Promise<void> {
    await Promise.all(Object.values(this.services).map((service) => service.recover()));
  }

  async idle(): Promise<void> {
    await Promise.all(Object.values(this.services).map((service) => service.idle()));
  }
}
