import type { PrismaClient } from '../generated/prisma/client.js';
import type { ConversationRecord, RunStatusValue } from './conversation.repository.js';

/** Read models for history, run detail and usage analytics (Phase 7, ADR-014). */

export type HistoryKindValue = 'conversation' | 'comparison';

export type HistoryListFilter = {
  userId: string;
  kind: 'all' | HistoryKindValue;
  /** Case-insensitive substring of the title or prompt; null for no search. */
  search: string | null;
  /** Only items where some run used this model. */
  model: { provider: string; model: string } | null;
  /** Inclusive start and exclusive end on last activity. */
  from: Date | null;
  to: Date | null;
  /** Keyset: only items after this position in (lastActivityAt desc, id desc) order. */
  after: { lastActivityAt: Date; id: string } | null;
  limit: number;
};

export type HistoryItemRecord = {
  kind: HistoryKindValue;
  id: string;
  /** The conversation title, or the first 200 characters of the comparison prompt. */
  title: string;
  createdAt: Date;
  lastActivityAt: Date;
};

/** The facts about one run that a history item summarizes. */
export type RunFact = {
  kind: HistoryKindValue;
  /** Conversation or comparison id. */
  ownerId: string;
  provider: string;
  model: string;
  status: RunStatusValue;
  estimatedCostUsd: number | null;
  createdAt: Date;
};

export type RunDetailRecord = {
  id: string;
  status: RunStatusValue;
  provider: string;
  model: string;
  requestedProvider: string | null;
  requestedModel: string | null;
  attemptCount: number;
  fallbackReason: string | null;
  ttftMs: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: string | null;
  estimatedCostUsd: number | null;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type ComparisonDetailRecord = {
  id: string;
  prompt: string;
  createdAt: Date;
  runs: (RunDetailRecord & { position: number; content: string | null })[];
};

export type UsageFilter = {
  /** null = every user (deployment scope). */
  userId: string | null;
  from: Date;
  /** Exclusive. */
  to: Date;
};

/** One aggregate row: per model, or the total when provider and model are null. */
export type UsageGroupRecord = {
  provider: string | null;
  model: string | null;
  runs: number;
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  inputTokens: number;
  outputTokens: number;
  providerCountedRuns: number;
  estimatedCostUsd: number;
  costedRuns: number;
  averageLatencyMs: number | null;
  /** Continuous 95th percentile over completed runs, whatever their number. */
  p95LatencyMs: number | null;
  fallbackRuns: number;
  activeUsers: number;
};

export type UsageDayRecord = {
  day: string;
  runs: number;
  failedRuns: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export interface HistoryRepository {
  /** Items for one user, newest activity first, at most `limit`. */
  listItems(filter: HistoryListFilter): Promise<HistoryItemRecord[]>;
  /** Runs of the given items, used for counts, models and cost. */
  runFacts(items: { kind: HistoryKindValue; id: string }[]): Promise<RunFact[]>;
  /** Every run of a conversation, oldest first. Ownership is checked by the caller. */
  conversationRuns(
    conversationId: string,
  ): Promise<(RunDetailRecord & { messageId: string | null })[]>;
  /** Null when it does not exist or belongs to someone else. */
  comparisonDetail(id: string, userId: string): Promise<ComparisonDetailRecord | null>;
  /** Changes the title without marking the conversation as active. Null when not the user's. */
  renameConversation(id: string, userId: string, title: string): Promise<ConversationRecord | null>;
  /** Permanently deletes it with its messages and runs. False when not the user's. */
  deleteConversation(id: string, userId: string): Promise<boolean>;
  deleteComparison(id: string, userId: string): Promise<boolean>;
  /** Per-model and total aggregates plus per-day rows over chat and comparison runs. */
  usage(filter: UsageFilter): Promise<{ groups: UsageGroupRecord[]; days: UsageDayRecord[] }>;
}

/** Escapes LIKE wildcards so a search for "50%" matches the text "50%". */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const toNumber = (value: { toString(): string } | null): number | null =>
  value === null ? null : Number(value.toString());

type PrismaRunRow = {
  id: string;
  status: RunStatusValue;
  provider: string;
  model: string;
  ttftMs: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: string | null;
  estimatedCostUsd: { toString(): string } | null;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

function runDetail(
  row: PrismaRunRow,
  fallback: Pick<
    RunDetailRecord,
    'requestedProvider' | 'requestedModel' | 'attemptCount' | 'fallbackReason'
  >,
): RunDetailRecord {
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    ...fallback,
    ttftMs: row.ttftMs,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    usageSource: row.usageSource,
    estimatedCostUsd: toNumber(row.estimatedCostUsd),
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

const NO_FALLBACK = {
  requestedProvider: null,
  requestedModel: null,
  attemptCount: 1,
  fallbackReason: null,
};

export function createPrismaHistoryRepository(prisma: PrismaClient): HistoryRepository {
  return {
    listItems: (filter) => {
      const pattern = filter.search === null ? null : `%${escapeLike(filter.search)}%`;
      const provider = filter.model?.provider ?? null;
      const model = filter.model?.model ?? null;
      const afterAt = filter.after?.lastActivityAt ?? null;
      const afterId = filter.after?.id ?? null;
      // Every branch is scoped to the user in SQL (ADR-014 §5), never filtered afterwards.
      return prisma.$queryRaw<HistoryItemRecord[]>`
        WITH items AS (
          SELECT 'conversation'::text AS "kind", c."id", c."title", c."createdAt",
                 c."updatedAt" AS "lastActivityAt"
          FROM "conversations" c
          WHERE c."userId" = ${filter.userId}::uuid
            AND ${filter.kind}::text IN ('all', 'conversation')
            AND (${pattern}::text IS NULL OR c."title" ILIKE ${pattern}::text ESCAPE '\\')
            AND (${provider}::text IS NULL OR EXISTS (
              SELECT 1 FROM "model_runs" r
              WHERE r."conversationId" = c."id"
                AND r."provider" = ${provider}::text AND r."model" = ${model}::text))
          UNION ALL
          SELECT 'comparison'::text, p."id", LEFT(p."prompt", 200), p."createdAt",
                 COALESCE((SELECT MAX(r."createdAt") FROM "comparison_runs" r
                           WHERE r."comparisonId" = p."id"), p."createdAt")
          FROM "comparisons" p
          WHERE p."userId" = ${filter.userId}::uuid
            AND ${filter.kind}::text IN ('all', 'comparison')
            AND (${pattern}::text IS NULL OR p."prompt" ILIKE ${pattern}::text ESCAPE '\\')
            AND (${provider}::text IS NULL OR EXISTS (
              SELECT 1 FROM "comparison_runs" r
              WHERE r."comparisonId" = p."id"
                AND r."provider" = ${provider}::text AND r."model" = ${model}::text))
        )
        SELECT "kind", "id", "title", "createdAt", "lastActivityAt"
        FROM items
        WHERE (${filter.from}::timestamptz IS NULL OR "lastActivityAt" >= ${filter.from}::timestamptz)
          AND (${filter.to}::timestamptz IS NULL OR "lastActivityAt" < ${filter.to}::timestamptz)
          AND (${afterAt}::timestamptz IS NULL
               OR ("lastActivityAt", "id") < (${afterAt}::timestamptz, ${afterId}::uuid))
        ORDER BY "lastActivityAt" DESC, "id" DESC
        LIMIT ${filter.limit}`;
    },

    runFacts: async (items) => {
      const conversationIds = items
        .filter((item) => item.kind === 'conversation')
        .map((item) => item.id);
      const comparisonIds = items
        .filter((item) => item.kind === 'comparison')
        .map((item) => item.id);
      const select = {
        provider: true,
        model: true,
        status: true,
        estimatedCostUsd: true,
        createdAt: true,
      } as const;
      const [chatRuns, comparisonRuns] = await Promise.all([
        conversationIds.length === 0
          ? []
          : prisma.modelRun.findMany({
              where: { conversationId: { in: conversationIds } },
              select: { ...select, conversationId: true },
            }),
        comparisonIds.length === 0
          ? []
          : prisma.comparisonRun.findMany({
              where: { comparisonId: { in: comparisonIds } },
              select: { ...select, comparisonId: true },
            }),
      ]);
      return [
        ...chatRuns.map((run) => ({
          kind: 'conversation' as const,
          ownerId: run.conversationId,
          provider: run.provider,
          model: run.model,
          status: run.status,
          estimatedCostUsd: toNumber(run.estimatedCostUsd),
          createdAt: run.createdAt,
        })),
        ...comparisonRuns.map((run) => ({
          kind: 'comparison' as const,
          ownerId: run.comparisonId,
          provider: run.provider,
          model: run.model,
          status: run.status,
          estimatedCostUsd: toNumber(run.estimatedCostUsd),
          createdAt: run.createdAt,
        })),
      ];
    },

    conversationRuns: async (conversationId) => {
      const runs = await prisma.modelRun.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return runs.map((run) => ({
        ...runDetail(run, {
          requestedProvider: run.requestedProvider,
          requestedModel: run.requestedModel,
          attemptCount: run.attemptCount,
          fallbackReason: run.fallbackReason,
        }),
        messageId: run.messageId,
      }));
    },

    comparisonDetail: async (id, userId) => {
      const comparison = await prisma.comparison.findFirst({
        where: { id, userId },
        include: { runs: { orderBy: { position: 'asc' } } },
      });
      if (!comparison) return null;
      return {
        id: comparison.id,
        prompt: comparison.prompt,
        createdAt: comparison.createdAt,
        runs: comparison.runs.map((run) => ({
          ...runDetail(run, NO_FALLBACK),
          position: run.position,
          content: run.content,
        })),
      };
    },

    // Raw SQL: Prisma's @updatedAt would otherwise move a renamed conversation to the top.
    renameConversation: async (id, userId, title) => {
      const rows = await prisma.$queryRaw<ConversationRecord[]>`
        UPDATE "conversations" SET "title" = ${title}
        WHERE "id" = ${id}::uuid AND "userId" = ${userId}::uuid
        RETURNING "id", "userId", "title", "guestMigrationKey", "summary",
                  "summaryUpToMessageId", "summaryUpdatedAt", "createdAt", "updatedAt"`;
      return rows[0] ?? null;
    },

    deleteConversation: async (id, userId) =>
      (await prisma.conversation.deleteMany({ where: { id, userId } })).count === 1,

    deleteComparison: async (id, userId) =>
      (await prisma.comparison.deleteMany({ where: { id, userId } })).count === 1,

    usage: async ({ userId, from, to }) => {
      // The same run set feeds both queries: chat runs and comparison runs with their owner.
      const [groups, days] = await Promise.all([
        prisma.$queryRaw<UsageGroupRecord[]>`
          WITH runs AS (
            SELECT c."userId", r."provider", r."model", r."status"::text AS "status",
                   r."inputTokens", r."outputTokens", r."usageSource", r."estimatedCostUsd",
                   r."latencyMs", (r."requestedProvider" IS NOT NULL) AS "fallback"
            FROM "model_runs" r JOIN "conversations" c ON c."id" = r."conversationId"
            WHERE r."createdAt" >= ${from} AND r."createdAt" < ${to}
              AND (${userId}::uuid IS NULL OR c."userId" = ${userId}::uuid)
            UNION ALL
            SELECT p."userId", r."provider", r."model", r."status"::text,
                   r."inputTokens", r."outputTokens", r."usageSource", r."estimatedCostUsd",
                   r."latencyMs", false
            FROM "comparison_runs" r JOIN "comparisons" p ON p."id" = r."comparisonId"
            WHERE r."createdAt" >= ${from} AND r."createdAt" < ${to}
              AND (${userId}::uuid IS NULL OR p."userId" = ${userId}::uuid)
          )
          SELECT "provider", "model",
            COUNT(*)::int AS "runs",
            (COUNT(*) FILTER (WHERE "status" = 'COMPLETED'))::int AS "completedRuns",
            (COUNT(*) FILTER (WHERE "status" IN ('FAILED', 'TIMEOUT')))::int AS "failedRuns",
            (COUNT(*) FILTER (WHERE "status" = 'CANCELLED'))::int AS "cancelledRuns",
            COALESCE(SUM("inputTokens"), 0)::float8 AS "inputTokens",
            COALESCE(SUM("outputTokens"), 0)::float8 AS "outputTokens",
            (COUNT(*) FILTER (WHERE "usageSource" = 'provider'))::int AS "providerCountedRuns",
            COALESCE(SUM("estimatedCostUsd"), 0)::float8 AS "estimatedCostUsd",
            COUNT("estimatedCostUsd")::int AS "costedRuns",
            (AVG("latencyMs") FILTER (WHERE "status" = 'COMPLETED'))::float8 AS "averageLatencyMs",
            (percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")
              FILTER (WHERE "status" = 'COMPLETED' AND "latencyMs" IS NOT NULL))::float8 AS "p95LatencyMs",
            (COUNT(*) FILTER (WHERE "fallback"))::int AS "fallbackRuns",
            COUNT(DISTINCT "userId")::int AS "activeUsers"
          FROM runs
          GROUP BY GROUPING SETS (("provider", "model"), ())`,
        prisma.$queryRaw<UsageDayRecord[]>`
          WITH runs AS (
            SELECT r."status"::text AS "status", r."inputTokens", r."outputTokens",
                   r."estimatedCostUsd", r."createdAt"
            FROM "model_runs" r JOIN "conversations" c ON c."id" = r."conversationId"
            WHERE r."createdAt" >= ${from} AND r."createdAt" < ${to}
              AND (${userId}::uuid IS NULL OR c."userId" = ${userId}::uuid)
            UNION ALL
            SELECT r."status"::text, r."inputTokens", r."outputTokens",
                   r."estimatedCostUsd", r."createdAt"
            FROM "comparison_runs" r JOIN "comparisons" p ON p."id" = r."comparisonId"
            WHERE r."createdAt" >= ${from} AND r."createdAt" < ${to}
              AND (${userId}::uuid IS NULL OR p."userId" = ${userId}::uuid)
          )
          SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
            COUNT(*)::int AS "runs",
            (COUNT(*) FILTER (WHERE "status" IN ('FAILED', 'TIMEOUT')))::int AS "failedRuns",
            COALESCE(SUM("inputTokens"), 0)::float8 AS "inputTokens",
            COALESCE(SUM("outputTokens"), 0)::float8 AS "outputTokens",
            COALESCE(SUM("estimatedCostUsd"), 0)::float8 AS "estimatedCostUsd"
          FROM runs
          GROUP BY 1
          ORDER BY 1`,
      ]);
      return { groups, days };
    },
  };
}
