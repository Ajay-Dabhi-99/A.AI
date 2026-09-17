import type { PrismaClient } from '../generated/prisma/client.js';
import { escapeLike } from './history.repository.js';

/** Persistence for signed-in users' chats (blueprint §8). Guests use Redis instead. */

export type ConversationRecord = {
  id: string;
  userId: string;
  title: string;
  guestMigrationKey: string | null;
  /** Running summary of the messages up to `summaryUpToMessageId` (Phase 5, ADR-012). */
  summary: string | null;
  summaryUpToMessageId: string | null;
  summaryUpdatedAt: Date | null;
  /** Set while pinned (MODEL-062). */
  pinnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageRoleValue = 'USER' | 'ASSISTANT';
export type RunStatusValue = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';

export type RunRecord = {
  id: string;
  conversationId: string;
  messageId: string | null;
  /** The model that answered (or last tried). */
  provider: string;
  model: string;
  status: RunStatusValue;
  ttftMs: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: string | null;
  errorCode: string | null;
  /** The model the user chose, when a fallback model answered (Phase 6). */
  requestedProvider: string | null;
  requestedModel: string | null;
  attemptCount: number;
  fallbackReason: string | null;
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

/** Set when another model than the one started with produced the outcome. */
export type RunFallback = {
  provider: string;
  model: string;
  requestedProvider: string;
  requestedModel: string;
  /** The error code that caused the switch. */
  reason: string;
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
  /** Provider calls made, including retries and fallbacks. Defaults to 1. */
  attemptCount?: number;
  fallback?: RunFallback;
  completedAt: Date;
};

export type ImportedMessage = {
  role: MessageRoleValue;
  content: string;
  createdAt: Date;
  run?: {
    provider: string;
    model: string;
    status: RunStatusValue;
    latencyMs?: number;
    fallbackFrom?: { provider: string; model: string };
  };
};

export type SummaryUpdate = {
  summary: string;
  upToMessageId: string;
  updatedAt: Date;
  /** The coverage the summary was built on; the write is skipped if it has changed since. */
  expectedUpToMessageId: string | null;
};

export interface ConversationRepository {
  create(data: { userId: string; title: string }): Promise<ConversationRecord>;
  /** Null when it does not exist or belongs to someone else. */
  findForUser(id: string, userId: string): Promise<ConversationRecord | null>;
  /** Pinned first (most recently pinned on top), then most recently active. */
  listForUser(userId: string, limit: number): Promise<ConversationRecord[]>;
  /**
   * The user's chats whose title or any message contains `text` (case-insensitive,
   * matched literally), pinned first then most recent, each with the newest
   * matching message when a message matched (MODEL-071).
   */
  search(
    userId: string,
    text: string,
    limit: number,
  ): Promise<{ conversation: ConversationRecord; match: string | null }[]>;
  /** Oldest first, each with its run when it has one. */
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  /**
   * Keeps the conversation up to `messageId` and deletes every later message
   * (their runs stay, unlinked). With `content`, that message's text is replaced
   * too. A summary covering a deleted message is cleared. Marks the chat active.
   * Returns the deleted message ids.
   */
  rewindTo(
    conversationId: string,
    messageId: string,
    content?: string,
    at?: Date,
  ): Promise<string[]>;
  /** Marks the conversation as recently active (an image was created in it). */
  touch(id: string, at: Date): Promise<void>;
  /** Adds the message and marks the conversation as recently active. */
  addUserMessage(conversationId: string, content: string): Promise<MessageRecord>;
  startRun(data: { conversationId: string; provider: string; model: string }): Promise<RunRecord>;
  /** Atomically records the outcome and, when there is content, the assistant message. */
  completeRun(
    runId: string,
    completion: RunCompletion,
  ): Promise<{ run: RunRecord; message: MessageRecord | null }>;
  /**
   * Compare-and-set on the summary coverage, so an older summary never replaces
   * a newer one. Does not change `updatedAt` (a summary is not user activity).
   * Resolves true when the summary was saved.
   */
  updateSummary(conversationId: string, update: SummaryUpdate): Promise<boolean>;
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
        orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
        take: limit,
      }),

    search: async (userId, text, limit) => {
      const pattern = `%${escapeLike(text)}%`;
      const rows = await prisma.$queryRaw<(ConversationRecord & { match: string | null })[]>`
        SELECT c."id", c."userId", c."title", c."guestMigrationKey", c."summary",
               c."summaryUpToMessageId", c."summaryUpdatedAt", c."pinnedAt",
               c."createdAt", c."updatedAt",
               (SELECT m."content" FROM "messages" m
                 WHERE m."conversationId" = c."id" AND m."content" ILIKE ${pattern} ESCAPE '\\'
                 ORDER BY m."createdAt" DESC LIMIT 1) AS "match"
        FROM "conversations" c
        WHERE c."userId" = ${userId}::uuid
          AND (c."title" ILIKE ${pattern} ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM "messages" m
                           WHERE m."conversationId" = c."id"
                             AND m."content" ILIKE ${pattern} ESCAPE '\\'))
        ORDER BY c."pinnedAt" DESC NULLS LAST, c."updatedAt" DESC, c."id" DESC
        LIMIT ${limit}`;
      return rows.map(({ match, ...conversation }) => ({ conversation, match }));
    },

    listMessages: (conversationId) =>
      prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        include: { run: true },
      }),

    rewindTo: (conversationId, messageId, content, at = new Date()) =>
      prisma.$transaction(async (tx) => {
        const target = await tx.message.findFirstOrThrow({
          where: { id: messageId, conversationId },
        });
        if (content !== undefined) {
          await tx.message.update({ where: { id: target.id }, data: { content } });
        }
        const later = await tx.message.findMany({
          where: { conversationId, createdAt: { gte: target.createdAt }, id: { not: target.id } },
          select: { id: true },
        });
        const ids = later.map((row) => row.id);
        if (ids.length > 0) {
          await tx.message.deleteMany({ where: { id: { in: ids } } });
          await tx.conversation.updateMany({
            where: { id: conversationId, summaryUpToMessageId: { in: ids } },
            data: { summary: null, summaryUpToMessageId: null, summaryUpdatedAt: null },
          });
        }
        await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: at } });
        return ids;
      }),

    touch: async (id, at) => {
      await prisma.conversation.updateMany({ where: { id }, data: { updatedAt: at } });
    },

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
        const { fallback } = completion;
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
            attemptCount: completion.attemptCount ?? 1,
            ...(fallback
              ? {
                  provider: fallback.provider,
                  model: fallback.model,
                  requestedProvider: fallback.requestedProvider,
                  requestedModel: fallback.requestedModel,
                  fallbackReason: fallback.reason,
                }
              : {}),
            completedAt: completion.completedAt,
          },
        });
        await tx.conversation.update({
          where: { id: completion.conversationId },
          data: { updatedAt: completion.completedAt },
        });
        return { run, message: message ? { ...message, run } : null };
      }),

    // Raw SQL: Prisma's @updatedAt would otherwise mark the conversation as recently active.
    updateSummary: async (conversationId, update) => {
      const changed = await prisma.$executeRaw`
        UPDATE "conversations"
        SET "summary" = ${update.summary},
            "summaryUpToMessageId" = ${update.upToMessageId}::uuid,
            "summaryUpdatedAt" = ${update.updatedAt}
        WHERE "id" = ${conversationId}::uuid
          AND "summaryUpToMessageId" IS NOT DISTINCT FROM ${update.expectedUpToMessageId}::uuid`;
      return changed === 1;
    },

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
                  requestedProvider: message.run.fallbackFrom?.provider ?? null,
                  requestedModel: message.run.fallbackFrom?.model ?? null,
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
