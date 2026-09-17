import type { ConversationShareResponse, SharedConversation } from '@a-ai/shared-types';
import { shareTokenSchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors/app-error.js';

const idParamsSchema = z.object({ id: z.uuid() });
const tokenParamsSchema = z.object({ token: shareTokenSchema });

function conversationId(params: unknown): string {
  const parsed = idParamsSchema.safeParse(params);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'This conversation does not exist.');
  return parsed.data.id;
}

/** Public read-only chat links (MODEL-070, docs/api/chat.md). */
export async function shareRoutes(app: FastifyInstance): Promise<void> {
  const { shares } = app.services;

  app.get(
    '/api/conversations/:id/share',
    async (request, reply): Promise<ConversationShareResponse> => {
      const { user } = await requireUser(request, reply);
      reply.header('cache-control', 'no-store');
      return shares.get(user.id, conversationId(request.params));
    },
  );

  app.post(
    '/api/conversations/:id/share',
    async (request, reply): Promise<ConversationShareResponse> => {
      const { user } = await requireUser(request, reply);
      reply.header('cache-control', 'no-store');
      return shares.share(user.id, conversationId(request.params));
    },
  );

  app.delete('/api/conversations/:id/share', async (request, reply) => {
    const { user } = await requireUser(request, reply);
    await shares.stop(user.id, conversationId(request.params));
    return reply.status(204).send();
  });

  /** Anyone with the link. Not cached, so stopping a share takes effect at once. */
  app.get('/api/shared/:token', async (request, reply): Promise<SharedConversation> => {
    const parsed = tokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new AppError('NOT_FOUND', 'This shared chat does not exist or was removed.');
    }
    reply.header('cache-control', 'no-store');
    reply.header('x-robots-tag', 'noindex, nofollow');
    return shares.read(parsed.data.token);
  });
}
