import type {
  ComparisonDetail,
  ConversationUpdateResponse,
  ConversationRunsResponse,
  HistoryItem,
  HistoryListResponse,
  RunDetail,
  UsageByDay,
  UsageReport,
  UsageTotals,
} from '@a-ai/shared-types';
import type { ConversationUpdate, HistoryQuery } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { ConversationRepository } from '../../repositories/conversation.repository.js';
import type {
  HistoryItemRecord,
  HistoryKindValue,
  HistoryRepository,
  RunDetailRecord,
  RunFact,
  UsageGroupRecord,
} from '../../repositories/history.repository.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { AttachmentService } from '../attachments/attachment.service.js';
import { toConversationSummary, toRunStatus } from '../chat/mappers.js';

/** Models listed per history item. */
export const HISTORY_ITEM_MODEL_LIMIT = 6;
/** A 95th percentile from fewer completed runs than this is noise, so it is not reported. */
export const P95_MIN_COMPLETED_RUNS = 20;
const DAY_MS = 86_400_000;
const TITLE_MAX_LENGTH = 120;

export type UsageScopeInput = { kind: 'personal'; userId: string } | { kind: 'deployment' };

export type HistoryServiceDeps = {
  history: HistoryRepository;
  conversations: ConversationRepository;
  attachments: Pick<
    AttachmentService,
    'keysForConversation' | 'removeObjects' | 'generatedIdsForConversation' | 'removeRows'
  >;
  clock: Clock;
  logger: FastifyBaseLogger;
};

const cursorSchema = z.object({ t: z.iso.datetime(), id: z.uuid() });

/** Opaque keyset cursor: the last item's activity time and id. */
export function encodeCursor(item: Pick<HistoryItemRecord, 'lastActivityAt' | 'id'>): string {
  return Buffer.from(
    JSON.stringify({ t: item.lastActivityAt.toISOString(), id: item.id }),
  ).toString('base64url');
}

export function decodeCursor(cursor: string): { lastActivityAt: Date; id: string } {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { lastActivityAt: new Date(parsed.t), id: parsed.id };
  } catch {
    throw new AppError('VALIDATION_ERROR', 'This page of history is no longer valid. Reload it.', {
      details: [{ path: 'cursor', message: 'Unreadable cursor' }],
    });
  }
}

/** A prompt on one line, shortened for a list. */
export function oneLine(text: string, max: number = TITLE_MAX_LENGTH): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line || 'Untitled';
}

function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function summarizeItem(record: HistoryItemRecord, facts: RunFact[]): HistoryItem {
  const ordered = [...facts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const models: HistoryItem['models'] = [];
  for (const fact of ordered) {
    if (models.length >= HISTORY_ITEM_MODEL_LIMIT) break;
    if (!models.some((ref) => ref.provider === fact.provider && ref.model === fact.model)) {
      models.push({ provider: fact.provider, model: fact.model });
    }
  }
  const known = facts.filter((fact) => fact.estimatedCostUsd !== null);
  return {
    kind: record.kind,
    id: record.id,
    title: record.kind === 'comparison' ? oneLine(record.title) : record.title,
    createdAt: record.createdAt.toISOString(),
    lastActivityAt: record.lastActivityAt.toISOString(),
    runCount: facts.length,
    failedRunCount: facts.filter((fact) => fact.status === 'FAILED' || fact.status === 'TIMEOUT')
      .length,
    models,
    estimatedCostUsd:
      known.length === 0
        ? null
        : roundUsd(known.reduce((sum, fact) => sum + (fact.estimatedCostUsd as number), 0)),
  };
}

export function toRunDetail(record: RunDetailRecord): RunDetail {
  return {
    id: record.id,
    status: toRunStatus(record.status),
    provider: record.provider,
    model: record.model,
    requested:
      record.requestedProvider !== null && record.requestedModel !== null
        ? { provider: record.requestedProvider, model: record.requestedModel }
        : null,
    attemptCount: record.attemptCount,
    fallbackReason: record.fallbackReason,
    ttftMs: record.ttftMs,
    latencyMs: record.latencyMs,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    usageSource:
      record.usageSource === 'provider' || record.usageSource === 'estimated'
        ? record.usageSource
        : null,
    estimatedCostUsd: record.estimatedCostUsd,
    errorCode: record.errorCode,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  };
}

const EMPTY_GROUP: UsageGroupRecord = {
  provider: null,
  model: null,
  runs: 0,
  completedRuns: 0,
  failedRuns: 0,
  cancelledRuns: 0,
  inputTokens: 0,
  outputTokens: 0,
  providerCountedRuns: 0,
  estimatedCostUsd: 0,
  costedRuns: 0,
  averageLatencyMs: null,
  p95LatencyMs: null,
  fallbackRuns: 0,
  activeUsers: 0,
};

export function toUsageTotals(group: UsageGroupRecord): UsageTotals {
  return {
    runs: group.runs,
    completedRuns: group.completedRuns,
    failedRuns: group.failedRuns,
    cancelledRuns: group.cancelledRuns,
    inputTokens: Math.round(group.inputTokens),
    outputTokens: Math.round(group.outputTokens),
    providerCountedRuns: group.providerCountedRuns,
    estimatedCostUsd: roundUsd(group.estimatedCostUsd),
    costedRuns: group.costedRuns,
    averageLatencyMs:
      group.completedRuns === 0 || group.averageLatencyMs === null
        ? null
        : Math.round(group.averageLatencyMs),
    p95LatencyMs:
      group.completedRuns < P95_MIN_COMPLETED_RUNS || group.p95LatencyMs === null
        ? null
        : Math.round(group.p95LatencyMs),
    fallbackRuns: group.fallbackRuns,
  };
}

/**
 * Saved history, run detail, rename/delete and usage analytics (blueprint §16
 * Phase 7, ADR-014). Every read is scoped to one user except the deployment
 * report, which returns aggregates only.
 */
export class HistoryService {
  readonly #deps: HistoryServiceDeps;

  constructor(deps: HistoryServiceDeps) {
    this.#deps = deps;
  }

  async list(userId: string, query: HistoryQuery): Promise<HistoryListResponse> {
    const records = await this.#deps.history.listItems({
      userId,
      kind: query.type,
      search: query.q ?? null,
      model:
        query.provider !== undefined && query.model !== undefined
          ? { provider: query.provider, model: query.model }
          : null,
      from: query.from ? dayStart(query.from) : null,
      to: query.to ? new Date(dayStart(query.to).getTime() + DAY_MS) : null,
      after: query.cursor ? decodeCursor(query.cursor) : null,
      // One extra row says whether another page exists.
      limit: query.limit + 1,
    });
    const page = records.slice(0, query.limit);
    const facts = await this.#deps.history.runFacts(page.map(({ kind, id }) => ({ kind, id })));
    const factsOf = (kind: HistoryKindValue, id: string) =>
      facts.filter((fact) => fact.kind === kind && fact.ownerId === id);

    const last = page.at(-1);
    return {
      items: page.map((record) => summarizeItem(record, factsOf(record.kind, record.id))),
      nextCursor: records.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async conversationRuns(
    userId: string,
    conversationId: string,
  ): Promise<ConversationRunsResponse> {
    const conversation = await this.#deps.conversations.findForUser(conversationId, userId);
    if (!conversation) throw new AppError('NOT_FOUND', 'This conversation does not exist.');
    const runs = await this.#deps.history.conversationRuns(conversation.id);
    return {
      conversation: toConversationSummary(conversation),
      runs: runs.map((run) => ({ ...toRunDetail(run), messageId: run.messageId })),
    };
  }

  async comparison(userId: string, comparisonId: string): Promise<ComparisonDetail> {
    const record = await this.#deps.history.comparisonDetail(comparisonId, userId);
    if (!record) throw new AppError('NOT_FOUND', 'This comparison does not exist.');
    return {
      id: record.id,
      prompt: record.prompt,
      createdAt: record.createdAt.toISOString(),
      runs: record.runs.map((run) => ({
        ...toRunDetail(run),
        position: run.position,
        content: run.content,
      })),
    };
  }

  /** Renames and/or pins a chat. Pinning an already pinned chat moves it back to the top. */
  async updateConversation(
    userId: string,
    conversationId: string,
    update: ConversationUpdate,
  ): Promise<ConversationUpdateResponse> {
    const updated = await this.#deps.history.updateConversation(conversationId, userId, {
      ...(update.title === undefined ? {} : { title: update.title }),
      ...(update.pinned === undefined
        ? {}
        : { pinnedAt: update.pinned ? this.#deps.clock.now() : null }),
    });
    if (!updated) throw new AppError('NOT_FOUND', 'This conversation does not exist.');
    return { conversation: toConversationSummary(updated) };
  }

  async delete(userId: string, kind: HistoryKindValue, id: string): Promise<void> {
    // Image objects are listed before the rows (and their attachment rows) cascade away.
    const imageKeys =
      kind === 'conversation' ? await this.#deps.attachments.keysForConversation(id, userId) : [];
    // Generated images belong to the chat's jobs, which cascade; their rows must go too.
    const generatedIds =
      kind === 'conversation'
        ? await this.#deps.attachments.generatedIdsForConversation(id, userId)
        : [];
    const deleted =
      kind === 'conversation'
        ? await this.#deps.history.deleteConversation(id, userId)
        : await this.#deps.history.deleteComparison(id, userId);
    if (deleted) {
      await this.#deps.attachments.removeObjects(imageKeys, 'conversation-deleted');
      await this.#deps.attachments.removeRows(generatedIds, 'conversation-deleted');
    }
    if (!deleted) {
      throw new AppError(
        'NOT_FOUND',
        kind === 'conversation'
          ? 'This conversation does not exist.'
          : 'This comparison does not exist.',
      );
    }
    // Ids only: never titles, prompts or answers (blueprint §13).
    this.#deps.logger.info({ event: 'history.deleted', userId, kind, id }, 'history item deleted');
  }

  /** The last `days` UTC days including today, every day present. */
  async usage(scope: UsageScopeInput, days: number): Promise<UsageReport> {
    const today = dayStart(isoDay(this.#deps.clock.now()));
    const from = new Date(today.getTime() - (days - 1) * DAY_MS);
    const to = new Date(today.getTime() + DAY_MS);

    const { groups, days: dayRows } = await this.#deps.history.usage({
      userId: scope.kind === 'personal' ? scope.userId : null,
      from,
      to,
    });

    const total = groups.find((group) => group.provider === null) ?? EMPTY_GROUP;
    const byModel = groups
      .filter((group) => group.provider !== null && group.model !== null)
      .map((group) => ({
        ...toUsageTotals(group),
        provider: group.provider as string,
        model: group.model as string,
      }))
      .sort(
        (a, b) =>
          b.runs - a.runs || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
      );

    const byDay: UsageByDay[] = [];
    for (let index = 0; index < days; index++) {
      const day = isoDay(new Date(from.getTime() + index * DAY_MS));
      const row = dayRows.find((candidate) => candidate.day === day);
      byDay.push({
        day,
        runs: row?.runs ?? 0,
        failedRuns: row?.failedRuns ?? 0,
        inputTokens: Math.round(row?.inputTokens ?? 0),
        outputTokens: Math.round(row?.outputTokens ?? 0),
        estimatedCostUsd: roundUsd(row?.estimatedCostUsd ?? 0),
      });
    }

    return {
      scope: scope.kind,
      range: { from: isoDay(from), to: isoDay(today), days },
      totals: toUsageTotals(total),
      byModel,
      byDay,
      activeUsers: scope.kind === 'deployment' ? total.activeUsers : null,
    };
  }
}
