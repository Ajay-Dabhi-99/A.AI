import type {
  ComparisonDetail,
  ConversationRenameResponse,
  ConversationRunsResponse,
  HistoryListResponse,
  UsageReport,
} from '@a-ai/shared-types';
import { conversationRenameSchema, historyQuerySchema, usageQuerySchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors/app-error.js';

const idParamsSchema = z.object({ id: z.uuid() });

/** A malformed id is reported like an unknown one, so ids cannot be probed. */
function idFrom(params: unknown, notFound: string): string {
  const parsed = idParamsSchema.safeParse(params);
  if (!parsed.success) throw new AppError('NOT_FOUND', notFound);
  return parsed.data.id;
}

const CONVERSATION_NOT_FOUND = 'This conversation does not exist.';
const COMPARISON_NOT_FOUND = 'This comparison does not exist.';

/** History, run detail and usage routes (docs/api/history.md). Signed-in users only. */
export async function historyRoutes(app: FastifyInstance): Promise<void> {
  const { history } = app.services;

  app.get('/api/history', async (request, reply): Promise<HistoryListResponse> => {
    const { user } = await requireUser(request, reply);
    const query = historyQuerySchema.parse(request.query ?? {});
    reply.header('cache-control', 'no-store');
    return history.list(user.id, query);
  });

  app.get(
    '/api/conversations/:id/runs',
    async (request, reply): Promise<ConversationRunsResponse> => {
      const { user } = await requireUser(request, reply);
      const id = idFrom(request.params, CONVERSATION_NOT_FOUND);
      reply.header('cache-control', 'no-store');
      return history.conversationRuns(user.id, id);
    },
  );

  app.patch(
    '/api/conversations/:id',
    async (request, reply): Promise<ConversationRenameResponse> => {
      const { user } = await requireUser(request, reply);
      const id = idFrom(request.params, CONVERSATION_NOT_FOUND);
      const { title } = conversationRenameSchema.parse(request.body ?? {});
      reply.header('cache-control', 'no-store');
      return history.rename(user.id, id, title);
    },
  );

  app.delete('/api/conversations/:id', async (request, reply) => {
    const { user } = await requireUser(request, reply);
    await history.delete(user.id, 'conversation', idFrom(request.params, CONVERSATION_NOT_FOUND));
    return reply.status(204).send();
  });

  app.get('/api/comparisons/:id', async (request, reply): Promise<ComparisonDetail> => {
    const { user } = await requireUser(request, reply);
    const id = idFrom(request.params, COMPARISON_NOT_FOUND);
    reply.header('cache-control', 'no-store');
    return history.comparison(user.id, id);
  });

  app.delete('/api/comparisons/:id', async (request, reply) => {
    const { user } = await requireUser(request, reply);
    await history.delete(user.id, 'comparison', idFrom(request.params, COMPARISON_NOT_FOUND));
    return reply.status(204).send();
  });

  /** The signed-in user's own usage. */
  app.get('/api/usage', async (request, reply): Promise<UsageReport> => {
    const { user } = await requireUser(request, reply);
    const { days } = usageQuerySchema.parse(request.query ?? {});
    reply.header('cache-control', 'no-store');
    return history.usage({ kind: 'personal', userId: user.id }, days);
  });

  /** Deployment-wide aggregates for administrators: no prompts, titles or per-user rows. */
  app.get('/api/admin/usage', async (request, reply): Promise<UsageReport> => {
    await requireAdmin(request, reply);
    const { days } = usageQuerySchema.parse(request.query ?? {});
    reply.header('cache-control', 'no-store');
    return history.usage({ kind: 'deployment' }, days);
  });
}
