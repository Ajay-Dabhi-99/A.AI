import type {
  JobStreamEvent,
  MediaGenerationStatus,
  MediaJobKind,
  MediaJobListResponse,
  MediaJobResponse,
} from '@a-ai/shared-types';
import {
  mediaGenerationStatusSchema,
  mediaJobListResponseSchema,
  mediaJobResponseSchema,
  parseJobStreamEvent,
  type MediaGenerateRequest,
} from '@a-ai/validation';
import { apiRequest } from './api';
import { getEventStream } from './event-stream';

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export const fetchMediaStatus = (
  kind: MediaJobKind,
  signal?: AbortSignal,
): Promise<MediaGenerationStatus> =>
  apiRequest(`/api/${kind}/status`, { schema: mediaGenerationStatusSchema, ...withSignal(signal) });

export const startMediaJob = (
  kind: MediaJobKind,
  body: MediaGenerateRequest,
): Promise<MediaJobResponse> =>
  apiRequest(`/api/${kind}/generate`, { method: 'POST', body, schema: mediaJobResponseSchema });

export const fetchJob = (id: string, signal?: AbortSignal): Promise<MediaJobResponse> =>
  apiRequest(`/api/jobs/${encodeURIComponent(id)}`, {
    schema: mediaJobResponseSchema,
    ...withSignal(signal),
  });

export const fetchJobs = (
  kind: MediaJobKind,
  limit: number,
  signal?: AbortSignal,
): Promise<MediaJobListResponse> =>
  apiRequest(`/api/jobs?kind=${kind}&limit=${limit}`, {
    schema: mediaJobListResponseSchema,
    ...withSignal(signal),
  });

export const cancelJob = (id: string): Promise<MediaJobResponse> =>
  apiRequest(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    schema: mediaJobResponseSchema,
  });

/** GET /api/jobs/:id/events: a snapshot now and on every change until the job ends. */
export function streamJob(
  id: string,
  options: { signal: AbortSignal; onEvent: (event: JobStreamEvent) => void },
): Promise<void> {
  return getEventStream(`/api/jobs/${encodeURIComponent(id)}/events`, {
    ...options,
    parse: parseJobStreamEvent,
  });
}
