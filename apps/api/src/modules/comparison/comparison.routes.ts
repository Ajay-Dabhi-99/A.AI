import type { ComparisonStreamEvent } from '@a-ai/shared-types';
import { comparisonRequestSchema, comparisonRunRequestSchema } from '@a-ai/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashedIp, resolveIdentity } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors/app-error.js';
import { openEventStream } from '../../shared/http/event-stream.js';
import type { ChatCaller } from '../chat/chat.service.js';
import type { PreparedComparison } from './comparison.service.js';

const comparisonParamsSchema = z.object({ comparisonId: z.uuid() });

async function callerFor(request: FastifyRequest, reply: FastifyReply): Promise<ChatCaller> {
  const identity = await resolveIdentity(request, reply, { createGuest: true });
  return identity.kind === 'user'
    ? { kind: 'user', userId: identity.user.id }
    : { kind: 'guest', guest: identity.guest, ipHash: hashedIp(request) };
}

/** Streams every run on one SSE connection. Closing the connection cancels every run. */
async function streamComparison(reply: FastifyReply, prepared: PreparedComparison): Promise<void> {
  const stream = openEventStream<ComparisonStreamEvent>(reply);
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) {
      controller.abort(new DOMException('The client disconnected', 'AbortError'));
    }
  });

  try {
    await prepared.execute(controller.signal, stream.send);
  } finally {
    stream.close();
  }
}

/** Comparison routes (docs/api/comparison.md). */
export async function comparisonRoutes(app: FastifyInstance): Promise<void> {
  const { comparison } = app.services;

  /** One prompt, 2–4 models, answered concurrently. */
  app.post('/api/compare', async (request, reply) => {
    const input = comparisonRequestSchema.parse(request.body ?? {});
    const caller = await callerFor(request, reply);
    // Limit, model, context and quota failures are plain JSON errors, before any stream.
    const prepared = await comparison.prepare(caller, input);
    await streamComparison(reply, prepared);
  });

  /** Runs the comparison's prompt on one model again: a failed column's Retry. */
  app.post('/api/compare/:comparisonId/runs', async (request, reply) => {
    const params = comparisonParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError('NOT_FOUND', 'This comparison does not exist or has expired.');
    }
    const input = comparisonRunRequestSchema.parse(request.body ?? {});
    const caller = await callerFor(request, reply);
    const prepared = await comparison.prepareRun(caller, params.data.comparisonId, input);
    await streamComparison(reply, prepared);
  });
}
