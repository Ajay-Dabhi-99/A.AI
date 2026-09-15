import type {
  HistoryRepository,
  RunDetailRecord,
  RunFact,
  UsageDayRecord,
  UsageGroupRecord,
} from '../../src/repositories/history.repository.js';
import type { RunStatusValue } from '../../src/repositories/conversation.repository.js';
import type { MemoryComparisons } from './memory-comparisons.js';
import type { MemoryConversations } from './memory-conversations.js';

/** A run with its owner, in the shape the SQL `runs` CTE produces. */
type UsageRow = {
  userId: string;
  provider: string;
  model: string;
  status: RunStatusValue;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: string | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
  fallback: boolean;
  createdAt: Date;
};

const costOf = (run: object): number | null =>
  (run as { estimatedCostUsd?: number | null }).estimatedCostUsd ?? null;

const likeMatch = (text: string, search: string | null) =>
  search === null || text.toLowerCase().includes(search.toLowerCase());

/** Linear interpolation, like PostgreSQL's percentile_cont. */
function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = fraction * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return (
    (sorted[lower] as number) +
    ((sorted[upper] as number) - (sorted[lower] as number)) * (rank - lower)
  );
}

function aggregate(
  rows: UsageRow[],
  provider: string | null,
  model: string | null,
): UsageGroupRecord {
  const completed = rows.filter((row) => row.status === 'COMPLETED');
  const latencies = completed.flatMap((row) => (row.latencyMs === null ? [] : [row.latencyMs]));
  const costed = rows.filter((row) => row.estimatedCostUsd !== null);
  return {
    provider,
    model,
    runs: rows.length,
    completedRuns: completed.length,
    failedRuns: rows.filter((row) => row.status === 'FAILED' || row.status === 'TIMEOUT').length,
    cancelledRuns: rows.filter((row) => row.status === 'CANCELLED').length,
    inputTokens: rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    outputTokens: rows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    providerCountedRuns: rows.filter((row) => row.usageSource === 'provider').length,
    estimatedCostUsd: costed.reduce((sum, row) => sum + (row.estimatedCostUsd as number), 0),
    costedRuns: costed.length,
    averageLatencyMs:
      latencies.length === 0
        ? null
        : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    p95LatencyMs: percentile(latencies, 0.95),
    fallbackRuns: rows.filter((row) => row.fallback).length,
    activeUsers: new Set(rows.map((row) => row.userId)).size,
  };
}

/**
 * In-memory HistoryRepository over the memory conversation and comparison
 * repositories; the SQL version runs in the live suite.
 */
export function createMemoryHistory(
  conversations: MemoryConversations,
  comparisons: MemoryComparisons,
): HistoryRepository {
  const { data: chat } = conversations;
  const { data: compare } = comparisons;

  const comparisonActivity = (id: string, createdAt: Date) =>
    compare.runs
      .filter((run) => run.comparisonId === id)
      .reduce((latest, run) => (run.createdAt > latest ? run.createdAt : latest), createdAt);

  const detail = (
    run: Omit<RunDetailRecord, 'estimatedCostUsd'>,
    cost: number | null,
  ): RunDetailRecord => ({
    id: run.id,
    status: run.status,
    provider: run.provider,
    model: run.model,
    requestedProvider: run.requestedProvider,
    requestedModel: run.requestedModel,
    attemptCount: run.attemptCount,
    fallbackReason: run.fallbackReason,
    ttftMs: run.ttftMs,
    latencyMs: run.latencyMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    usageSource: run.usageSource,
    estimatedCostUsd: cost,
    errorCode: run.errorCode,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  });

  return {
    listItems: async (filter) => {
      const usedModel = (runs: { provider: string; model: string }[]) =>
        filter.model === null ||
        runs.some(
          (run) => run.provider === filter.model?.provider && run.model === filter.model.model,
        );

      const items = [
        ...(filter.kind === 'comparison'
          ? []
          : chat.conversations
              .filter(
                (conversation) =>
                  conversation.userId === filter.userId &&
                  likeMatch(conversation.title, filter.search) &&
                  usedModel(chat.runs.filter((run) => run.conversationId === conversation.id)),
              )
              .map((conversation) => ({
                kind: 'conversation' as const,
                id: conversation.id,
                title: conversation.title,
                createdAt: conversation.createdAt,
                lastActivityAt: conversation.updatedAt,
              }))),
        ...(filter.kind === 'conversation'
          ? []
          : compare.comparisons
              .filter(
                (comparison) =>
                  comparison.userId === filter.userId &&
                  likeMatch(comparison.prompt, filter.search) &&
                  usedModel(compare.runs.filter((run) => run.comparisonId === comparison.id)),
              )
              .map((comparison) => ({
                kind: 'comparison' as const,
                id: comparison.id,
                title: comparison.prompt.slice(0, 200),
                createdAt: comparison.createdAt,
                lastActivityAt: comparisonActivity(comparison.id, comparison.createdAt),
              }))),
      ];

      const after = filter.after;
      return items
        .filter(
          (item) =>
            (filter.from === null || item.lastActivityAt >= filter.from) &&
            (filter.to === null || item.lastActivityAt < filter.to) &&
            (after === null ||
              item.lastActivityAt < after.lastActivityAt ||
              (item.lastActivityAt.getTime() === after.lastActivityAt.getTime() &&
                item.id < after.id)),
        )
        .sort(
          (a, b) =>
            b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
            (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        )
        .slice(0, filter.limit);
    },

    runFacts: async (items) =>
      items.flatMap((item): RunFact[] =>
        item.kind === 'conversation'
          ? chat.runs
              .filter((run) => run.conversationId === item.id)
              .map((run) => ({
                kind: 'conversation' as const,
                ownerId: item.id,
                provider: run.provider,
                model: run.model,
                status: run.status,
                estimatedCostUsd: costOf(run),
                createdAt: run.createdAt,
              }))
          : compare.runs
              .filter((run) => run.comparisonId === item.id)
              .map((run) => ({
                kind: 'comparison' as const,
                ownerId: item.id,
                provider: run.provider,
                model: run.model,
                status: run.status,
                estimatedCostUsd: run.estimatedCostUsd,
                createdAt: run.createdAt,
              })),
      ),

    conversationRuns: async (conversationId) =>
      chat.runs
        .filter((run) => run.conversationId === conversationId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((run) => ({ ...detail(run, costOf(run)), messageId: run.messageId })),

    comparisonDetail: async (id, userId) => {
      const comparison = compare.comparisons.find(
        (candidate) => candidate.id === id && candidate.userId === userId,
      );
      if (!comparison) return null;
      return {
        id: comparison.id,
        prompt: comparison.prompt,
        createdAt: comparison.createdAt,
        runs: compare.runs
          .filter((run) => run.comparisonId === id)
          .sort((a, b) => a.position - b.position)
          .map((run) => ({
            ...detail(
              {
                ...run,
                requestedProvider: null,
                requestedModel: null,
                attemptCount: 1,
                fallbackReason: null,
              },
              run.estimatedCostUsd,
            ),
            position: run.position,
            content: run.content,
          })),
      };
    },

    renameConversation: async (id, userId, title) => {
      const conversation = chat.conversations.find(
        (candidate) => candidate.id === id && candidate.userId === userId,
      );
      if (!conversation) return null;
      conversation.title = title;
      return { ...conversation };
    },

    // Cascades like the foreign keys: messages and runs go with their owner.
    deleteConversation: async (id, userId) => {
      const index = chat.conversations.findIndex(
        (candidate) => candidate.id === id && candidate.userId === userId,
      );
      if (index < 0) return false;
      chat.conversations.splice(index, 1);
      chat.messages.splice(
        0,
        chat.messages.length,
        ...chat.messages.filter((m) => m.conversationId !== id),
      );
      chat.runs.splice(
        0,
        chat.runs.length,
        ...chat.runs.filter((run) => run.conversationId !== id),
      );
      return true;
    },

    deleteComparison: async (id, userId) => {
      const index = compare.comparisons.findIndex(
        (candidate) => candidate.id === id && candidate.userId === userId,
      );
      if (index < 0) return false;
      compare.comparisons.splice(index, 1);
      compare.runs.splice(
        0,
        compare.runs.length,
        ...compare.runs.filter((run) => run.comparisonId !== id),
      );
      return true;
    },

    usage: async ({ userId, from, to }) => {
      const inRange = (createdAt: Date) => createdAt >= from && createdAt < to;
      const owner = (conversationId: string) =>
        chat.conversations.find((conversation) => conversation.id === conversationId)?.userId;
      const comparisonOwner = (comparisonId: string) =>
        compare.comparisons.find((comparison) => comparison.id === comparisonId)?.userId;

      const rows: UsageRow[] = [
        ...chat.runs.flatMap((run) => {
          const runUser = owner(run.conversationId);
          if (!runUser || !inRange(run.createdAt) || (userId !== null && runUser !== userId))
            return [];
          return [
            {
              userId: runUser,
              provider: run.provider,
              model: run.model,
              status: run.status,
              inputTokens: run.inputTokens,
              outputTokens: run.outputTokens,
              usageSource: run.usageSource,
              estimatedCostUsd: costOf(run),
              latencyMs: run.latencyMs,
              fallback: run.requestedProvider !== null,
              createdAt: run.createdAt,
            },
          ];
        }),
        ...compare.runs.flatMap((run) => {
          const runUser = comparisonOwner(run.comparisonId);
          if (!runUser || !inRange(run.createdAt) || (userId !== null && runUser !== userId))
            return [];
          return [
            {
              userId: runUser,
              provider: run.provider,
              model: run.model,
              status: run.status,
              inputTokens: run.inputTokens,
              outputTokens: run.outputTokens,
              usageSource: run.usageSource,
              estimatedCostUsd: run.estimatedCostUsd,
              latencyMs: run.latencyMs,
              fallback: false,
              createdAt: run.createdAt,
            },
          ];
        }),
      ];

      const models = new Map<string, UsageRow[]>();
      for (const row of rows) {
        const key = `${row.provider}\n${row.model}`;
        models.set(key, [...(models.get(key) ?? []), row]);
      }
      const groups = [
        ...[...models.values()].map((modelRows) =>
          aggregate(modelRows, modelRows[0]?.provider ?? null, modelRows[0]?.model ?? null),
        ),
        aggregate(rows, null, null),
      ];

      const byDay = new Map<string, UsageRow[]>();
      for (const row of rows) {
        const day = row.createdAt.toISOString().slice(0, 10);
        byDay.set(day, [...(byDay.get(day) ?? []), row]);
      }
      const days: UsageDayRecord[] = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, dayRows]) => {
          const totals = aggregate(dayRows, null, null);
          return {
            day,
            runs: totals.runs,
            failedRuns: totals.failedRuns,
            inputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens,
            estimatedCostUsd: totals.estimatedCostUsd,
          };
        });

      return { groups, days };
    },
  };
}
