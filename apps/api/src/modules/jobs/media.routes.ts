import { setTimeout as sleep } from 'node:timers/promises';
import {
  isTerminalJobStatus,
  type JobStreamEvent,
  type MediaGenerationStatus,
  type MediaJobListResponse,
  type MediaJobResponse,
} from '@a-ai/shared-types';
import { jobListQuerySchema, MEDIA_JOB_KINDS, mediaGenerateRequestSchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors/app-error.js';
import { openEventStream } from '../../shared/http/event-stream.js';
import { JOB_STREAM_MAX_MS } from './job-center.js';

const idParamsSchema = z.object({ id: z.uuid() });

/** A malformed id is reported like an unknown one, so ids cannot be probed. */
function idFrom(params: unknown, notFound: string): string {
  const parsed = idParamsSchema.safeParse(params);
  if (!parsed.success) throw new AppError('NOT_FOUND', notFound);
  return parsed.data.id;
}

/** Image and video generation jobs (docs/api/generation.md, ADR-016). */
export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const { jobs } = app.services;

  for (const kind of MEDIA_JOB_KINDS) {
    const service = jobs.services[kind];
    const notFound = `This ${kind} job does not exist.`;

    /** Whether this kind is offered, and with which models. Public. */
    app.get(`/api/${kind}/status`, async (_request, reply): Promise<MediaGenerationStatus> => {
      reply.header('cache-control', 'no-store');
      return service.status();
    });

    app.post(`/api/${kind}/generate`, async (request, reply): Promise<MediaJobResponse> => {
      const { user } = await requireUser(request, reply);
      const input = mediaGenerateRequestSchema.parse(request.body ?? {});
      const response = await service.start(user.id, input);
      reply.status(202).header('cache-control', 'no-store');
      return response;
    });

    app.get(`/api/${kind}/:id`, async (request, reply): Promise<MediaJobResponse> => {
      const { user } = await requireUser(request, reply);
      const id = idFrom(request.params, notFound);
      reply.header('cache-control', 'no-store');
      return service.get(user.id, id);
    });
  }

  /** The user's recent jobs, newest first, so a page can resume them after a refresh. */
  app.get('/api/jobs', async (request, reply): Promise<MediaJobListResponse> => {
    const { user } = await requireUser(request, reply);
    const query = jobListQuerySchema.parse(request.query ?? {});
    reply.header('cache-control', 'no-store');
    return jobs.list(user.id, query.kind, query.limit);
  });

  app.get('/api/jobs/:id', async (request, reply): Promise<MediaJobResponse> => {
    const { user } = await requireUser(request, reply);
    const id = idFrom(request.params, 'This job does not exist.');
    reply.header('cache-control', 'no-store');
    return jobs.get(user.id, id);
  });

  app.post('/api/jobs/:id/cancel', async (request, reply): Promise<MediaJobResponse> => {
    const { user } = await requireUser(request, reply);
    const id = idFrom(request.params, 'This job does not exist.');
    reply.header('cache-control', 'no-store');
    return jobs.cancel(user.id, id);
  });

  /**
   * Server-Sent Events: a full snapshot on connect, then one on every change,
   * closing when the job ends. A client that reconnects (after a refresh or a
   * dropped connection) simply receives the current snapshot again.
   */
  app.get('/api/jobs/:id/events', async (request, reply) => {
    const { user } = await requireUser(request, reply);
    const id = idFrom(request.params, 'This job does not exist.');
    // Unknown jobs are a JSON 404 before the stream opens.
    const initial = (await jobs.get(user.id, id)).job;

    const stream = openEventStream<JobStreamEvent>(reply);
    stream.send({ event: 'job', data: initial });
    if (isTerminalJobStatus(initial.status)) {
      stream.close();
      return;
    }

    let disconnected = false;
    reply.raw.on('close', () => {
      disconnected = true;
    });
    const deadline = Date.now() + JOB_STREAM_MAX_MS;
    let last = JSON.stringify(initial);
    try {
      while (!disconnected && Date.now() < deadline) {
        await sleep(jobs.streamPollMs);
        if (disconnected) break;
        const { job } = await jobs.get(user.id, id);
        const snapshot = JSON.stringify(job);
        if (snapshot !== last) {
          stream.send({ event: 'job', data: job });
          last = snapshot;
        }
        if (isTerminalJobStatus(job.status)) break;
      }
    } catch (error) {
      request.log.warn({ err: error, jobId: id }, 'job event stream ended early');
    } finally {
      stream.close();
    }
  });
}
