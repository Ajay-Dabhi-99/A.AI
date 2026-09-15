import { randomUUID } from 'node:crypto';
import type {
  ConversationRecord,
  ConversationRepository,
  MessageRecord,
  RunRecord,
} from '../../src/repositories/conversation.repository.js';

export type MemoryConversations = ConversationRepository & {
  data: {
    conversations: ConversationRecord[];
    messages: Omit<MessageRecord, 'run'>[];
    runs: RunRecord[];
  };
};

/** In-memory ConversationRepository for tests; the Prisma version runs in the live suite. */
export function createMemoryConversations(): MemoryConversations {
  const data: MemoryConversations['data'] = { conversations: [], messages: [], runs: [] };
  let tick = 0;
  // Strictly increasing timestamps keep ordering deterministic within one test.
  const now = () => new Date(Date.UTC(2026, 8, 13, 10, 0, 0) + tick++);

  const withRun = (message: Omit<MessageRecord, 'run'>): MessageRecord => ({
    ...message,
    run: data.runs.find((run) => run.messageId === message.id) ?? null,
  });

  const touch = (conversationId: string, at: Date) => {
    const conversation = data.conversations.find((candidate) => candidate.id === conversationId);
    if (conversation) conversation.updatedAt = at;
  };

  return {
    data,

    create: async ({ userId, title }) => {
      const at = now();
      const conversation: ConversationRecord = {
        id: randomUUID(),
        userId,
        title,
        guestMigrationKey: null,
        createdAt: at,
        updatedAt: at,
      };
      data.conversations.push(conversation);
      return { ...conversation };
    },

    findForUser: async (id, userId) => {
      const found = data.conversations.find(
        (candidate) => candidate.id === id && candidate.userId === userId,
      );
      return found ? { ...found } : null;
    },

    listForUser: async (userId, limit) =>
      data.conversations
        .filter((conversation) => conversation.userId === userId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, limit)
        .map((conversation) => ({ ...conversation })),

    listMessages: async (conversationId) =>
      data.messages
        .filter((message) => message.conversationId === conversationId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(withRun),

    addUserMessage: async (conversationId, content) => {
      const at = now();
      const message = {
        id: randomUUID(),
        conversationId,
        role: 'USER' as const,
        content,
        createdAt: at,
      };
      data.messages.push(message);
      touch(conversationId, at);
      return { ...message, run: null };
    },

    startRun: async ({ conversationId, provider, model }) => {
      const run: RunRecord = {
        id: randomUUID(),
        conversationId,
        messageId: null,
        provider,
        model,
        status: 'RUNNING',
        ttftMs: null,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        usageSource: null,
        errorCode: null,
        createdAt: now(),
        completedAt: null,
      };
      data.runs.push(run);
      return { ...run };
    },

    completeRun: async (runId, completion) => {
      const run = data.runs.find((candidate) => candidate.id === runId);
      if (!run) throw new Error(`run ${runId} not found`);
      let message: Omit<MessageRecord, 'run'> | null = null;
      if (completion.messageContent !== null) {
        message = {
          id: randomUUID(),
          conversationId: completion.conversationId,
          role: 'ASSISTANT',
          content: completion.messageContent,
          createdAt: now(),
        };
        data.messages.push(message);
      }
      Object.assign(run, {
        status: completion.status,
        messageId: message?.id ?? null,
        ttftMs: completion.ttftMs,
        latencyMs: completion.latencyMs,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        usageSource: completion.usageSource,
        errorCode: completion.errorCode,
        estimatedCostUsd: completion.estimatedCostUsd,
        completedAt: completion.completedAt,
      });
      touch(completion.conversationId, completion.completedAt);
      return { run: { ...run }, message: message ? { ...message, run: { ...run } } : null };
    },

    importGuestConversation: async ({ userId, title, guestMigrationKey, messages }) => {
      const existing = data.conversations.find(
        (candidate) => candidate.guestMigrationKey === guestMigrationKey,
      );
      if (existing) return { conversation: { ...existing }, created: false };

      const at = now();
      const conversation: ConversationRecord = {
        id: randomUUID(),
        userId,
        title,
        guestMigrationKey,
        createdAt: at,
        updatedAt: at,
      };
      data.conversations.push(conversation);
      for (const imported of messages) {
        const message = {
          id: randomUUID(),
          conversationId: conversation.id,
          role: imported.role,
          content: imported.content,
          createdAt: imported.createdAt,
        };
        data.messages.push(message);
        if (imported.run) {
          data.runs.push({
            id: randomUUID(),
            conversationId: conversation.id,
            messageId: message.id,
            provider: imported.run.provider,
            model: imported.run.model,
            status: imported.run.status,
            ttftMs: null,
            latencyMs: imported.run.latencyMs ?? null,
            inputTokens: null,
            outputTokens: null,
            usageSource: null,
            errorCode: null,
            createdAt: imported.createdAt,
            completedAt: imported.createdAt,
          });
        }
      }
      return { conversation: { ...conversation }, created: true };
    },
  };
}
