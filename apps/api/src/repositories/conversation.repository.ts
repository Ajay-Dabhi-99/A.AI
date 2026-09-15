import type { PrismaClient } from '../generated/prisma/client.js';

/** Persistence for signed-in users' chats (blueprint §8). Guests use Redis instead. */

export type ConversationRecord = {
  id: string;
  userId: string;
  title: string;
  guestMigrationKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageRoleValue = 'USER' | 'ASSISTANT';
export type RunStatusValue = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';

export type RunRecord = {
  id: string;
  conversationId: string;
  messageId: string | null;
  provider: string;
  model: string;
  status: RunStatusValue;
  ttftMs: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: string | null;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  role: MessageRoleValue;
  content: string;
  createdAt: Date;
  run: RunRecord | null;
};

export type RunCompletion = {
  conversationId: string;
  status: Exclude<RunStatusValue, 'RUNNING'>;
  /** Assistant text to save as a message, or null to save none (failures). */
  messageContent: string | null;
  ttftMs: number | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: 'provider' | 'estimated' | null;
  errorCode: string | null;
  /** From registry prices; null when a price or token count is unknown. */
  estimatedCostUsd: number | null;
  completedAt: Date;
};

export type ImportedMessage = {
  role: MessageRoleValue;
  content: string;
  createdAt: Date;
  run?: { provider: string; model: string; status: RunStatusValue; latencyMs?: number };
};

export interface ConversationRepository {
  create(data: { userId: string; title: string }): Promise<ConversationRecord>;
  /** Null when it does not exist or belongs to someone else. */
  findForUser(id: string, userId: string): Promise<ConversationRecord | null>;
  /** Most recently active first. */
  listForUser(userId: string, limit: number): Promise<ConversationRecord[]>;
  /** Oldest first, each with its run when it has one. */
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  /** Adds the message and marks the conversation as recently active. */
  addUserMessage(conversationId: string, content: string): Promise<MessageRecord>;
  startRun(data: { conversationId: string; provider: string; model: string }): Promise<RunRecord>;
  /** Atomically records the outcome and, when there is content, the assistant message. */
  completeRun(
    runId: string,
    completion: RunCompletion,
  ): Promise<{ run: RunRecord; message: MessageRecord | null }>;
  /**
   * Creates a conversation from a guest chat. Idempotent on guestMigrationKey:
   * a second call returns the existing conversation with created=false.
   */
  importGuestConversation(data: {
    userId: string;
    title: string;
    guestMigrationKey: string;
    messages: ImportedMessage[];
  }): Promise<{ conversation: ConversationRecord; created: boolean }>;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

export function createPrismaConversationRepository(prisma: PrismaClient): ConversationRepository {
  return {
    create: (data) => prisma.conversation.create({ data }),

    findForUser: (id, userId) => prisma.conversation.findFirst({ where: { id, userId } }),

    listForUser: (userId, limit) =>
      prisma.conversation.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),

    listMessages: (conversationId) =>
      prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        include: { run: true },
      }),

    addUserMessage: async (conversationId, content) => {
      const [message] = await prisma.$transaction([
        prisma.message.create({ data: { conversationId, role: 'USER', content } }),
        prisma.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        }),
      ]);
      return { ...message, run: null };
    },

    startRun: (data) => prisma.modelRun.create({ data }),

    completeRun: (runId, completion) =>
      prisma.$transaction(async (tx) => {
        const message =
          completion.messageContent === null
            ? null
            : await tx.message.create({
                data: {
                  conversationId: completion.conversationId,
                  role: 'ASSISTANT',
                  content: completion.messageContent,
                },
              });
        const run = await tx.modelRun.update({
          where: { id: runId },
          data: {
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
          },
        });
        await tx.conversation.update({
          where: { id: completion.conversationId },
          data: { updatedAt: completion.completedAt },
        });
        return { run, message: message ? { ...message, run } : null };
      }),

    importGuestConversation: async ({ userId, title, guestMigrationKey, messages }) => {
      try {
        const conversation = await prisma.$transaction(async (tx) => {
          const created = await tx.conversation.create({
            data: { userId, title, guestMigrationKey },
          });
          for (const message of messages) {
            const saved = await tx.message.create({
              data: {
                conversationId: created.id,
                role: message.role,
                content: message.content,
                createdAt: message.createdAt,
              },
            });
            if (message.run) {
              await tx.modelRun.create({
                data: {
                  conversationId: created.id,
                  messageId: saved.id,
                  provider: message.run.provider,
                  model: message.run.model,
                  status: message.run.status,
                  latencyMs: message.run.latencyMs ?? null,
                  completedAt: message.createdAt,
                  createdAt: message.createdAt,
                },
              });
            }
          }
          return created;
        });
        return { conversation, created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await prisma.conversation.findUnique({ where: { guestMigrationKey } });
        if (!existing) throw error;
        return { conversation: existing, created: false };
      }
    },
  };
}
