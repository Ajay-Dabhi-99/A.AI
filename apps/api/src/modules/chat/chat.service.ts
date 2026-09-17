import { createHash, randomUUID } from 'node:crypto';
import { isAIProviderError, type AIProvider } from '@a-ai/ai-core';
import type {
  AIImageInput,
  AIModel,
  AIUsage,
  ChatContextInfo,
  ChatMessage,
  ChatMessageRun,
  ChatStreamEvent,
  ErrorCode,
  RunError,
} from '@a-ai/shared-types';
import type { ChatRequest } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import { estimateTokens } from '../../ai/context-builder.js';
import { estimateCostUsd } from '../../ai/cost.js';
import { fallbackCandidates } from '../../ai/model-router.js';
import {
  DEFAULT_RETRY_POLICY,
  decideAfterFailure,
  sleep,
  type RetryPolicy,
} from '../../ai/retry-policy.js';
import { toRunError } from '../../ai/run-error.js';
import { normalizeUsage } from '../../ai/usage.js';
import type { ModelRegistryService } from '../../providers/model-registry.service.js';
import type { ProviderHealthService } from '../../providers/provider-health.service.js';
import type {
  ConversationRepository,
  RunFallback,
  RunStatusValue,
} from '../../repositories/conversation.repository.js';
import type {
  ContextPlan,
  ContextScope,
  ContextService,
  HistoryMessage,
  SummaryState,
} from '../../services/context.service.js';
import type { QuotaService, QuotaSubject } from '../../services/quota.service.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { AttachmentService } from '../attachments/attachment.service.js';
import type { GuestSession } from '../guest/guest.service.js';
import type { GuestConversationStore } from './guest-conversation.store.js';
import { conversationTitle, toRunStatus } from './mappers.js';

/** Upper bound for one reply, whatever the model allows. */
export const CHAT_MAX_OUTPUT_TOKENS = 4_096;

export const SYSTEM_PROMPT =
  'You are A.ai, a helpful assistant. Answer clearly and accurately. Use Markdown formatting when it makes the answer easier to read. If you are not sure, say so.';

export type ChatCaller =
  { kind: 'user'; userId: string } | { kind: 'guest'; guest: GuestSession; ipHash: string };

export type EmitEvent = (event: ChatStreamEvent) => void;

export type PreparedChat = {
  runId: string;
  conversationId: string | null;
  model: AIModel;
  context: ChatContextInfo;
  /** Streams the answer through `emit` and records the outcome. Never throws. */
  execute(signal: AbortSignal, emit: EmitEvent): Promise<void>;
};

export type ChatServiceDeps = {
  models: ModelRegistryService;
  conversations: ConversationRepository;
  guestChats: GuestConversationStore;
  context: ContextService;
  health: ProviderHealthService;
  quota: QuotaService;
  /** Images sent with a message (Phase 8, ADR-015). */
  attachments: Pick<AttachmentService, 'prepareForMessage' | 'attach' | 'forMessages'>;
  /** Let another healthy model answer when the chosen one fails before any text (ADR-013). */
  fallbackEnabled: boolean;
  retryPolicy?: Partial<RetryPolicy>;
  clock: Clock;
  logger: FastifyBaseLogger;
};

/** One model the request is being answered with. */
type Attempt = {
  provider: AIProvider;
  model: AIModel;
  plan: ContextPlan;
  maxOutputTokens: number;
};

const modelKey = (model: Pick<AIModel, 'provider' | 'id'>) => `${model.provider}\n${model.id}`;

/**
 * Single-model chat (blueprint §4 request path, §10) with retries and
 * fallback (§16 Phase 6, ADR-013). `prepare` does every check that can reject
 * the request before streaming starts, so those failures are ordinary JSON
 * errors; `execute` owns the stream and always records how the run ended.
 */
export class ChatService {
  readonly #deps: ChatServiceDeps;
  readonly #policy: RetryPolicy;

  constructor(deps: ChatServiceDeps) {
    this.#deps = deps;
    this.#policy = { ...DEFAULT_RETRY_POLICY, ...deps.retryPolicy };
  }

  async prepare(caller: ChatCaller, input: ChatRequest): Promise<PreparedChat> {
    const {
      models,
      conversations,
      guestChats,
      context,
      health,
      quota,
      attachments,
      clock,
      logger,
    } = this.#deps;
    const { provider, model } = await models.resolve(input.provider, input.model);

    // Images are checked and read before quota: a rejected image never uses up allowance.
    const attachmentIds = input.attachmentIds ?? [];
    let images: AIImageInput[] = [];
    if (attachmentIds.length > 0) {
      if (caller.kind !== 'user') {
        throw new AppError('AUTH_REQUIRED', 'Sign up to attach images.');
      }
      images = (await attachments.prepareForMessage(caller.userId, attachmentIds, model)).images;
    }

    let conversationId: string | null = null;
    let history: HistoryMessage[] = [];
    let guestMessages: ChatMessage[] = [];
    let summary: SummaryState = null;

    if (caller.kind === 'user') {
      if (input.conversationId) {
        const conversation = await conversations.findForUser(input.conversationId, caller.userId);
        if (!conversation) throw new AppError('NOT_FOUND', 'This conversation does not exist.');
        conversationId = conversation.id;
        if (conversation.summary !== null && conversation.summaryUpToMessageId !== null) {
          summary = {
            summary: conversation.summary,
            upToMessageId: conversation.summaryUpToMessageId,
          };
        }
        history = (await conversations.listMessages(conversation.id)).map((message) => ({
          id: message.id,
          role: message.role === 'USER' ? 'user' : 'assistant',
          content: message.content,
        }));
      }
    } else {
      guestMessages = await guestChats.get(caller.guest.id);
      summary = await context.guestSummary(caller.guest.id);
      history = guestMessages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
      }));
    }

    // Regenerate and edit rewind the chat to its latest question (MODEL-068).
    const lastQuestionIndex = history.findLastIndex((message) => message.role === 'user');
    const lastQuestion = history[lastQuestionIndex];
    let rewind: { messageId: string; removed: string[]; content?: string } | null = null;
    if (input.retry) {
      if (history.at(-1)?.role !== 'user') {
        throw new AppError('VALIDATION_ERROR', 'There is no unanswered message to retry.');
      }
    } else if (input.regenerate || input.edit) {
      if (!lastQuestion?.id || (input.regenerate && history.at(-1)?.role !== 'assistant')) {
        throw new AppError(
          'VALIDATION_ERROR',
          input.regenerate ? 'There is no answer to regenerate.' : 'There is no message to edit.',
        );
      }
      if (input.edit && caller.kind === 'user') {
        const sent = await attachments.forMessages([lastQuestion.id]);
        if ((sent.get(lastQuestion.id)?.length ?? 0) > 0) {
          throw new AppError('VALIDATION_ERROR', 'Messages with images cannot be edited.');
        }
      }
      const removed = history
        .slice(lastQuestionIndex + 1)
        .flatMap((message) => (message.id ? [message.id] : []));
      rewind = {
        messageId: lastQuestion.id,
        removed,
        ...(input.edit ? { content: input.message as string } : {}),
      };
      history = [
        ...history.slice(0, lastQuestionIndex),
        input.edit ? { ...lastQuestion, content: input.message as string } : lastQuestion,
      ];
      // A summary that covered a removed message no longer describes the chat.
      if (summary && removed.includes(summary.upToMessageId)) summary = null;
    } else {
      history = [
        ...history,
        {
          role: 'user',
          content: input.message as string,
          ...(images.length > 0 ? { images } : {}),
        },
      ];
    }
    const sendsNewMessage = !input.retry && rewind === null;

    const planFor = (candidate: AIModel) => {
      const maxOutputTokens = Math.min(candidate.maxOutputTokens, CHAT_MAX_OUTPUT_TOKENS);
      return context
        .plan({
          model: candidate,
          systemPrompt: SYSTEM_PROMPT,
          maxOutputTokens,
          history,
          summary,
          historyMayBeTrimmed: caller.kind === 'guest',
        })
        .then((plan) => ({ plan, maxOutputTokens }));
    };

    // Before quota: a request that cannot fit must not use up allowance.
    const primary = await planFor(model);
    const contextInfo: ChatContextInfo = {
      inputTokens: primary.plan.context.estimatedInputTokens,
      budgetTokens: primary.plan.context.budgetTokens,
      contextWindow: model.contextWindow,
      droppedMessages: primary.plan.context.droppedMessages,
      summaryIncluded: primary.plan.context.summaryIncluded,
    };

    const subject: QuotaSubject =
      caller.kind === 'user'
        ? { kind: 'user', id: caller.userId }
        : { kind: 'guest', id: caller.guest.id };
    const ipHash = caller.kind === 'guest' ? caller.ipHash : undefined;
    await quota.consume(subject, ipHash ? { ipHash } : {});

    let runId: string;
    try {
      if (caller.kind === 'user') {
        if (rewind) {
          await conversations.rewindTo(
            conversationId as string,
            rewind.messageId,
            rewind.content,
            clock.now(),
          );
        } else if (sendsNewMessage) {
          conversationId ??= (
            await conversations.create({
              userId: caller.userId,
              title: conversationTitle(input.message as string),
            })
          ).id;
          const saved = await conversations.addUserMessage(conversationId, input.message as string);
          await attachments.attach(caller.userId, attachmentIds, saved.id);
        }
        runId = (
          await conversations.startRun({
            conversationId: conversationId as string,
            provider: model.provider,
            model: model.id,
          })
        ).id;
      } else {
        if (rewind) {
          const { messageId, content, removed } = rewind;
          const kept = guestMessages.findIndex((message) => message.id === messageId);
          guestMessages = guestMessages
            .slice(0, kept + 1)
            .map((message) =>
              message.id === messageId && content !== undefined ? { ...message, content } : message,
            );
          await guestChats.save(caller.guest, guestMessages);
          const stored = await context.guestSummary(caller.guest.id);
          if (stored && removed.includes(stored.upToMessageId)) {
            await context.clearGuest(caller.guest.id);
          }
        } else if (sendsNewMessage) {
          guestMessages = [
            ...guestMessages,
            {
              id: randomUUID(),
              role: 'user',
              content: input.message as string,
              createdAt: clock.now().toISOString(),
            },
          ];
          await guestChats.save(caller.guest, guestMessages);
        }
        runId = randomUUID();
      }
    } catch (error) {
      await quota.refund(subject, ipHash ? { ipHash } : {});
      throw error;
    }

    const scope: ContextScope =
      caller.kind === 'user'
        ? { kind: 'conversation', conversationId: conversationId as string }
        : { kind: 'guest', guest: caller.guest };
    const policy = this.#policy;
    const fallbackEnabled = this.#deps.fallbackEnabled;

    const execute = async (signal: AbortSignal, emit: EmitEvent): Promise<void> => {
      const startedAt = performance.now();
      const elapsed = () => Math.round(performance.now() - startedAt);
      const requested = { provider: model.provider, model: model.id };
      const tried = new Set([modelKey(model)]);

      let current: Attempt = { provider, model, ...primary };
      let isPrimary = true;
      let attemptsOnModel = 0;
      let attemptCount = 0;
      let fallbacksUsed = 0;
      let fallbackReason: ErrorCode | null = null;
      let ttftMs: number | null = null;
      let text = '';
      let usage: AIUsage | null = null;

      emit({
        event: 'message.start',
        data: {
          runId,
          provider: model.provider,
          model: model.id,
          conversationId,
          context: contextInfo,
        },
      });

      const answeredByFallback = () =>
        current.model.provider !== requested.provider || current.model.id !== requested.model;

      const record = async (
        status: Exclude<RunStatusValue, 'RUNNING'>,
        errorCode: string | null,
      ) => {
        const keepText = (status === 'COMPLETED' || status === 'CANCELLED') && text.length > 0;
        const latencyMs = elapsed();
        const finalUsage = normalizeUsage(usage, {
          inputTokens: current.plan.context.estimatedInputTokens,
          outputTokens: estimateTokens(text, current.plan.charsPerToken),
        });
        const fallback: RunFallback | undefined = answeredByFallback()
          ? {
              provider: current.model.provider,
              model: current.model.id,
              requestedProvider: requested.provider,
              requestedModel: requested.model,
              reason: fallbackReason ?? 'MODEL_UNAVAILABLE',
            }
          : undefined;

        if (caller.kind === 'user') {
          const { message } = await conversations.completeRun(runId, {
            conversationId: conversationId as string,
            status,
            messageContent: keepText ? text : null,
            ttftMs,
            latencyMs,
            inputTokens: finalUsage.inputTokens ?? null,
            outputTokens: finalUsage.outputTokens ?? null,
            usageSource: finalUsage.source,
            errorCode,
            estimatedCostUsd: estimateCostUsd(current.model, finalUsage),
            attemptCount: Math.max(1, attemptCount),
            ...(fallback ? { fallback } : {}),
            completedAt: clock.now(),
          });
          return { messageId: message?.id ?? null, latencyMs, usage: finalUsage };
        }

        if (keepText) {
          const run: ChatMessageRun = {
            provider: current.model.provider,
            model: current.model.id,
            status: toRunStatus(status),
            latencyMs,
            ...(fallback ? { fallbackFrom: requested } : {}),
          };
          guestMessages = [
            ...guestMessages,
            {
              id: randomUUID(),
              role: 'assistant',
              content: text,
              createdAt: clock.now().toISOString(),
              run,
            },
          ];
          await guestChats.save(caller.guest, guestMessages);
        }
        return { messageId: null, latencyMs, usage: finalUsage };
      };

      const refund = () => quota.refund(subject, ipHash ? { ipHash } : {}).catch(() => undefined);

      const finishCancelled = async () => {
        const outcome = await record('CANCELLED', null).catch((recordError: unknown) => {
          logger.error({ err: recordError, runId }, 'failed to record cancelled run');
          return { messageId: null, latencyMs: elapsed() };
        });
        if (!text) await refund();
        emit({
          event: 'message.done',
          data: {
            runId,
            status: 'cancelled',
            messageId: outcome.messageId,
            latencyMs: outcome.latencyMs,
          },
        });
      };

      const canFallBack = () => fallbackEnabled && fallbacksUsed < policy.maxFallbackModels;

      const isDown = (providerId: string) =>
        health.isDown(providerId).catch((error: unknown) => {
          logger.warn({ err: error, provider: providerId }, 'provider health unavailable');
          return false;
        });

      /** The next model that can take over, planned for its own context window. Null when none. */
      const nextCandidate = async (): Promise<Attempt | null> => {
        try {
          const available = await models.available();
          const down = await health
            .downProviders(available.map((candidate) => candidate.provider))
            .catch(() => new Set<string>());
          for (const candidate of fallbackCandidates(
            current.model,
            available,
            (id) => down.has(id),
            { vision: images.length > 0 },
          )) {
            if (tried.has(modelKey(candidate))) continue;
            tried.add(modelKey(candidate));
            try {
              const resolved = await models.resolve(candidate.provider, candidate.id);
              const planned = await planFor(resolved.model);
              return { provider: resolved.provider, model: resolved.model, ...planned };
            } catch (error) {
              // A candidate that cannot fit this conversation, or vanished meanwhile, is skipped.
              if (error instanceof AppError) continue;
              throw error;
            }
          }
        } catch (error) {
          logger.error({ err: error, runId }, 'fallback selection failed');
        }
        return null;
      };

      const switchTo = (next: Attempt, code: ErrorCode, reason: string) => {
        emit({
          event: 'message.fallback',
          data: {
            runId,
            from: { provider: current.model.provider, model: current.model.id },
            to: { provider: next.model.provider, model: next.model.id },
            code,
            reason,
          },
        });
        logger.info(
          {
            event: 'chat.fallback',
            runId,
            fromProvider: current.model.provider,
            fromModel: current.model.id,
            toProvider: next.model.provider,
            toModel: next.model.id,
            code,
          },
          'answering with a fallback model',
        );
        current = next;
        isPrimary = false;
        attemptsOnModel = 0;
        fallbacksUsed += 1;
        fallbackReason = code;
      };

      for (;;) {
        // A provider whose circuit is open is skipped when another model can answer.
        if (attemptsOnModel === 0 && canFallBack() && (await isDown(current.model.provider))) {
          const next = await nextCandidate();
          if (next) {
            switchTo(
              next,
              'MODEL_UNAVAILABLE',
              `${current.model.name} is temporarily unavailable.`,
            );
            continue;
          }
        }

        attemptsOnModel += 1;
        attemptCount += 1;
        usage = null;

        try {
          for await (const chunk of current.provider.stream({
            model: current.model.id,
            messages: current.plan.context.messages,
            maxOutputTokens: current.maxOutputTokens,
            signal,
          })) {
            if (chunk.type === 'delta') {
              ttftMs ??= elapsed();
              text += chunk.text;
              emit({ event: 'message.delta', data: { runId, text: chunk.text } });
            } else if (chunk.type === 'usage') {
              usage = chunk.usage;
            }
          }
          await health.recordSuccess(current.model.provider).catch((error: unknown) => {
            logger.warn({ err: error, runId }, 'provider health update failed');
          });

          const outcome = await record('COMPLETED', null);
          emit({ event: 'usage', data: { runId, usage: outcome.usage } });
          emit({
            event: 'message.done',
            data: {
              runId,
              status: 'completed',
              messageId: outcome.messageId,
              latencyMs: outcome.latencyMs,
            },
          });
          context.afterCompletedRun({
            scope,
            provider: current.provider,
            model: current.model,
            plan: current.plan,
            providerInputTokens:
              outcome.usage.source === 'provider' ? (outcome.usage.inputTokens ?? null) : null,
          });
          return;
        } catch (error) {
          if (signal.aborted) {
            await finishCancelled();
            return;
          }

          const decision = decideAfterFailure(error, {
            attemptsOnModel,
            maxAttempts: isPrimary ? policy.maxAttemptsPerModel : 1,
            producedText: text.length > 0,
            policy,
          });
          if (decision.providerFault && isAIProviderError(error)) {
            await health
              .recordFailure(current.model.provider, error)
              .catch((healthError: unknown) => {
                logger.warn({ err: healthError, runId }, 'provider health update failed');
              });
          }

          if (decision.retry && isAIProviderError(error)) {
            emit({
              event: 'message.retry',
              data: {
                runId,
                attempt: attemptCount + 1,
                delayMs: decision.retry.delayMs,
                code: error.code,
              },
            });
            try {
              await sleep(decision.retry.delayMs, signal);
            } catch {
              await finishCancelled();
              return;
            }
            continue;
          }

          if (decision.fallback && isAIProviderError(error) && canFallBack()) {
            const next = await nextCandidate();
            if (next) {
              switchTo(next, error.code, error.message);
              continue;
            }
          }

          const runError = this.#toRunError(error, runId);
          // Nothing was produced: the attempt should not use up daily allowance.
          if (!text) await refund();
          await record(
            runError.code === 'PROVIDER_TIMEOUT' ? 'TIMEOUT' : 'FAILED',
            runError.code,
          ).catch((recordError: unknown) => {
            logger.error({ err: recordError, runId }, 'failed to record failed run');
          });
          emit({ event: 'error', data: { runId, ...runError } });
          return;
        }
      }
    };

    return { runId, conversationId, model, context: contextInfo, execute };
  }

  /** "New chat" for a guest: removes the temporary chat and its summary. */
  async clearGuest(guestId: string): Promise<void> {
    await Promise.all([
      this.#deps.guestChats.clear(guestId),
      this.#deps.context.clearGuest(guestId),
    ]);
  }

  /** Moves a guest's temporary chat into the user's saved conversations. Idempotent. */
  async migrateGuest(userId: string, guest: GuestSession): Promise<string | null> {
    const { guestChats, conversations } = this.#deps;
    const messages = await guestChats.get(guest.id);
    if (messages.length === 0) return null;

    const firstQuestion = messages.find((message) => message.role === 'user')?.content ?? '';
    const { conversation } = await conversations.importGuestConversation({
      userId,
      title: conversationTitle(firstQuestion),
      guestMigrationKey: createHash('sha256').update(`guest-migration ${guest.id}`).digest('hex'),
      messages: messages.map((message) => ({
        role: message.role === 'user' ? 'USER' : 'ASSISTANT',
        content: message.content,
        createdAt: new Date(message.createdAt),
        ...(message.run
          ? {
              run: {
                provider: message.run.provider,
                model: message.run.model,
                status: message.run.status.toUpperCase() as RunStatusValue,
                ...(message.run.latencyMs === undefined
                  ? {}
                  : { latencyMs: message.run.latencyMs }),
                ...(message.run.fallbackFrom ? { fallbackFrom: message.run.fallbackFrom } : {}),
              },
            }
          : {}),
      })),
    });
    // The guest summary's coverage points at temporary message ids, so it is not carried over.
    await this.clearGuest(guest.id);
    return conversation.userId === userId ? conversation.id : null;
  }

  #toRunError(error: unknown, runId: string): RunError {
    return toRunError(error, (unexpected) =>
      this.#deps.logger.error({ err: unexpected, runId }, 'unexpected chat failure'),
    );
  }
}
