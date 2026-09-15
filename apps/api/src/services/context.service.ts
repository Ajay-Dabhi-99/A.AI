import type { AIProvider } from '@a-ai/ai-core';
import type { AIMessage, AIModel } from '@a-ai/shared-types';
import type { FastifyBaseLogger } from 'fastify';
import { buildContext, type BuiltContext } from '../ai/context-builder.js';
import type { ConversationSummarizer } from '../ai/summarizer.js';
import type { TokenService } from '../ai/token.service.js';
import type { GuestSession } from '../modules/guest/guest.service.js';
import type { ConversationRepository } from '../repositories/conversation.repository.js';
import type { Clock } from '../shared/clock.js';
import type { KeyValueStore } from './kv-store.js';

/** Longest a summary may hold its conversation's lock (the summarizer's own timeout is 30 s). */
export const SUMMARY_LOCK_TTL_MS = 60_000;

/** A history entry. Saved messages have an id; the message being sent may not have one yet. */
export type HistoryMessage = AIMessage & { id?: string };

export type SummaryState = { summary: string; upToMessageId: string } | null;

/** Where context state lives: a saved conversation, or a guest's temporary chat. */
export type ContextScope =
  { kind: 'conversation'; conversationId: string } | { kind: 'guest'; guest: GuestSession };

export type ContextPlan = {
  context: BuiltContext;
  charsPerToken: number;
  /** The summary this request was planned with, or null. */
  summary: SummaryState;
  /** Saved messages left out of this request that no summary covers, oldest first. */
  uncovered: (AIMessage & { id: string })[];
};

type StoredGuestContext = { summary: string; upToMessageId: string; updatedAt: string };

export type ContextServiceDeps = {
  store: KeyValueStore;
  conversations: ConversationRepository;
  tokens: TokenService;
  summarizer: ConversationSummarizer;
  summariesEnabled: boolean;
  clock: Clock;
  logger: FastifyBaseLogger;
};

/** Images travel only with the message they were sent with (ADR-015 §5). */
const toAIMessage = ({ role, content, images }: AIMessage): AIMessage =>
  images?.length ? { role, content, images } : { role, content };

function guestContextKey(guestId: string): string {
  return `context:guest:${guestId}`;
}

/**
 * Context and token management (blueprint §10, ADR-012): plans each request's
 * bounded context with the model's calibrated token estimate and the
 * conversation summary, then, after a completed answer, calibrates estimates
 * and folds left-out messages into the summary in the background.
 */
export class ContextService {
  readonly #deps: ContextServiceDeps;
  readonly #pending = new Set<Promise<void>>();

  constructor(deps: ContextServiceDeps) {
    this.#deps = deps;
  }

  /** A guest's summary (users' summaries are read with their conversation). */
  async guestSummary(guestId: string): Promise<SummaryState> {
    const stored = await this.#deps.store.getJson<Partial<StoredGuestContext>>(
      guestContextKey(guestId),
    );
    return typeof stored?.summary === 'string' && typeof stored.upToMessageId === 'string'
      ? { summary: stored.summary, upToMessageId: stored.upToMessageId }
      : null;
  }

  async clearGuest(guestId: string): Promise<void> {
    await this.#deps.store.delete(guestContextKey(guestId));
  }

  /**
   * Builds the bounded context for one request. Messages the summary covers are
   * replaced by the summary. @throws AppError CONTEXT_TOO_LARGE
   */
  async plan(input: {
    model: AIModel;
    systemPrompt: string;
    maxOutputTokens: number;
    history: HistoryMessage[];
    summary: SummaryState;
    /** Guest chats keep only their newest messages, so a missing coverage point was trimmed away. */
    historyMayBeTrimmed?: boolean;
  }): Promise<ContextPlan> {
    const { model, systemPrompt, maxOutputTokens, history, summary } = input;
    const charsPerToken = await this.#deps.tokens.charsPerToken(model);

    let applied: SummaryState = null;
    let recent = history;
    if (summary) {
      const covered = history.findIndex((message) => message.id === summary.upToMessageId);
      if (covered >= 0) {
        applied = summary;
        recent = history.slice(covered + 1);
      } else if (input.historyMayBeTrimmed) {
        // Everything still in the chat is newer than the summary.
        applied = summary;
      }
      // Otherwise the coverage point is unknown: the summary is ignored rather than trusted.
    }

    const context = buildContext({
      systemPrompt,
      summary: applied?.summary ?? null,
      history: recent.map(toAIMessage),
      contextWindow: model.contextWindow,
      maxOutputTokens,
      charsPerToken,
    });

    const uncovered = recent
      .slice(0, context.droppedMessages)
      .filter((message): message is AIMessage & { id: string } => typeof message.id === 'string')
      // Summaries are text only.
      .map(({ id, role, content }) => ({ id, role, content }));

    return { context, charsPerToken, summary: applied, uncovered };
  }

  /**
   * After a completed answer: calibrates the model's token estimate from the
   * provider's count and, when messages were left out, updates the summary.
   * Runs in the background and never throws.
   */
  afterCompletedRun(input: {
    scope: ContextScope;
    provider: AIProvider;
    model: AIModel;
    plan: ContextPlan;
    /** Exact input tokens reported by the provider, or null when they were estimated. */
    providerInputTokens: number | null;
  }): void {
    const { scope, provider, model, plan, providerInputTokens } = input;
    const { tokens, logger, summariesEnabled } = this.#deps;

    // Image tokens are not text: calibrating on them would skew the characters-per-token ratio.
    const hasImages = plan.context.messages.some((message) => (message.images?.length ?? 0) > 0);
    if (providerInputTokens !== null && !hasImages) {
      const characters = plan.context.messages.reduce(
        (sum, message) => sum + message.content.length,
        0,
      );
      this.#track(
        tokens.record(model, characters, providerInputTokens).catch((error: unknown) => {
          logger.warn(
            { err: error, event: 'tokens.calibration.failed' },
            'token calibration failed',
          );
        }),
      );
    }

    if (summariesEnabled && plan.uncovered.length > 0) {
      this.#track(this.#summarize(scope, provider, model, plan));
    }
  }

  /** Resolves when every background task has finished (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  #track(task: Promise<void>): void {
    this.#pending.add(task);
    const settle = () => {
      this.#pending.delete(task);
    };
    task.then(settle, settle);
  }

  async #summarize(
    scope: ContextScope,
    provider: AIProvider,
    model: AIModel,
    plan: ContextPlan,
  ): Promise<void> {
    const { store, conversations, summarizer, clock, logger } = this.#deps;
    const base =
      scope.kind === 'conversation'
        ? `context:${scope.conversationId}`
        : guestContextKey(scope.guest.id);
    const lockKey = `${base}:summary-lock`;
    const log = {
      event: 'context.summary',
      scope: scope.kind,
      provider: model.provider,
      model: model.id,
    };

    try {
      const locked = await store.setJsonIfAbsent(
        lockKey,
        { startedAt: clock.now().toISOString() },
        SUMMARY_LOCK_TTL_MS,
      );
      // Another request is already summarizing this conversation.
      if (!locked) return;
    } catch (error) {
      logger.warn({ ...log, outcome: 'failed', err: error }, 'summary lock unavailable');
      return;
    }

    try {
      const upToMessageId = (plan.uncovered.at(-1) as { id: string }).id;
      const summary = await summarizer.summarize({
        provider,
        model,
        previousSummary: plan.summary?.summary ?? null,
        messages: plan.uncovered.map(toAIMessage),
      });
      const updatedAt = clock.now();

      if (scope.kind === 'conversation') {
        const saved = await conversations.updateSummary(scope.conversationId, {
          summary,
          upToMessageId,
          updatedAt,
          expectedUpToMessageId: plan.summary?.upToMessageId ?? null,
        });
        if (!saved) {
          logger.info({ ...log, outcome: 'superseded' }, 'a newer conversation summary exists');
          return;
        }
      } else {
        const ttlMs = Date.parse(scope.guest.expiresAt) - updatedAt.getTime();
        if (ttlMs <= 0) return;
        const stored: StoredGuestContext = {
          summary,
          upToMessageId,
          updatedAt: updatedAt.toISOString(),
        };
        await store.setJson(guestContextKey(scope.guest.id), stored, ttlMs);
      }

      logger.info(
        {
          ...log,
          outcome: 'updated',
          foldedMessages: plan.uncovered.length,
          summaryCharacters: summary.length,
        },
        'conversation summary updated',
      );
    } catch (error) {
      logger.warn(
        { ...log, outcome: 'failed', err: error },
        'conversation summary failed; trimming continues',
      );
    } finally {
      await store.delete(lockKey).catch(() => undefined);
    }
  }
}
