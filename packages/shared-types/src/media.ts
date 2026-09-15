import type { GenerationJobKind, GenerationJobStatus } from './ai.js';
import type { Attachment } from './attachments.js';

/** Asynchronous image and video jobs (Phases 8–9, docs/api/generation.md, ADR-016). */

export type MediaJobKind = Extract<GenerationJobKind, 'image' | 'video'>;

export type MediaJob = {
  id: string;
  kind: MediaJobKind;
  status: GenerationJobStatus;
  provider: string;
  model: string;
  prompt: string;
  /** 0–1 while processing when the provider reports it; 1 when completed; otherwise null. */
  progress: number | null;
  errorCode: string | null;
  /** The generated file, once the job completed. */
  attachment: Attachment | null;
  createdAt: string;
  completedAt: string | null;
};

/** GET /api/image/status and GET /api/video/status */
export type MediaGenerationStatus = {
  enabled: boolean;
  models: { provider: string; model: string; name: string }[];
};

/** POST /api/{image,video}/generate, GET /api/{image,video,jobs}/:id, POST /api/jobs/:id/cancel */
export type MediaJobResponse = {
  job: MediaJob;
};

/** GET /api/jobs?kind= */
export type MediaJobListResponse = {
  jobs: MediaJob[];
};

/**
 * GET /api/jobs/:id/events. Every event is a full snapshot, so a client that
 * reconnects needs nothing but the next event.
 */
export type JobStreamEvent = { event: 'job'; data: MediaJob };

export function isTerminalJobStatus(status: GenerationJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
