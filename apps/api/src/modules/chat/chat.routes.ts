import type {
  ConversationDetail,
  ConversationListResponse,
  GuestConversationResponse,
  GuestMigrationResponse,
} from '@a-ai/shared-types';
import { chatRequestSchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashedIp, requireUser, resolveIdentity } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors/app-error.js';
import { clearCookie } from '../../shared/http/cookies.js';
import { openEventStream } from '../../shared/http/event-stream.js';
import type { ChatCaller } from './chat.service.js';
import { toChatMessage, toConversationSummary } from './mappers.js';

const CONVERSATION_LIST_LIMIT = 50;
const conversationParamsSchema = z.object({ id: z.uuid() });

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  const { env, cookieNames } = app;
  const { chat, conversations, guestChats, guests } = app.services;

  /** Streams one answer as Server-Sent Events (docs/api/chat.md). */
  app.post('/api/chat', async (request, reply) => {
    const input = chatRequestSchema.parse(request.body ?? {});
    const identity = await resolveIdentity(request, reply, { createGuest: true });
    const caller: ChatCaller =
      identity.kind === 'user'
        ? { kind: 'user', userId: identity.user.id }
        : { kind: 'guest', guest: identity.guest, ipHash: hashedIp(request) };

    // Validation, model, context and quota failures are plain JSON errors.
    const prepared = await chat.prepare(caller, input);

    const stream = openEventStream(reply);
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
  });

  app.get('/api/conversations', async (request, reply): Promise<ConversationListResponse> => {
    const { user } = await requireUser(request, reply);
    const list = await conversations.listForUser(user.id, CONVERSATION_LIST_LIMIT);
    reply.header('cache-control', 'no-store');
    return { conversations: list.map(toConversationSummary) };
  });

  app.get('/api/conversations/:id', async (request, reply): Promise<ConversationDetail> => {
    const { user } = await requireUser(request, reply);
    const params = conversationParamsSchema.safeParse(request.params);
    const conversation = params.success
      ? await conversations.findForUser(params.data.id, user.id)
      : null;
    if (!conversation) throw new AppError('NOT_FOUND', 'This conversation does not exist.');

    reply.header('cache-control', 'no-store');
    return {
      ...toConversationSummary(conversation),
      messages: (await conversations.listMessages(conversation.id)).map(toChatMessage),
    };
  });

  app.get('/api/guest/conversation', async (request, reply): Promise<GuestConversationResponse> => {
    const identity = await resolveIdentity(request, reply, { createGuest: true });
    if (identity.kind === 'user') {
      throw new AppError('FORBIDDEN', 'Signed-in accounts use saved conversations.');
    }
    reply.header('cache-control', 'no-store');
    return {
      messages: await guestChats.get(identity.guest.id),
      expiresAt: identity.guest.expiresAt,
    };
  });

  app.delete('/api/guest/conversation', async (request, reply) => {
    const identity = await resolveIdentity(request, reply, { createGuest: false });
    if (identity.kind === 'guest') await guestChats.clear(identity.guest.id);
    return reply.status(204).send();
  });

  /** After sign-in: moves the guest chat into the account. Safe to call more than once. */
  app.post('/api/guest/migrate', async (request, reply): Promise<GuestMigrationResponse> => {
    const { user } = await requireUser(request, reply);
    const guestId = request.cookies[cookieNames.guest];
    const guest = guestId ? await guests.find(guestId) : null;
    if (!guest) return { conversationId: null };

    const conversationId = await chat.migrateGuest(user.id, guest);
    await guests.end(guest.id);
    clearCookie(reply, env, cookieNames.guest);
    return { conversationId };
  });
}
