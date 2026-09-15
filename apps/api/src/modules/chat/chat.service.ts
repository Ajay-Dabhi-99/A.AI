import { createHash, randomUUID } from 'node:crypto';
import type {
  AIModel,
  AIUsage,
  ChatContextInfo,
  ChatMessage,
  ChatStreamEvent,
  RunError,
} from '@a-ai/shared-types';
import type { ChatRequest } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import { estimateTokens } from '../../ai/context-builder.js';
import { estimateCostUsd } from '../../ai/cost.js';
import { toRunError } from '../../ai/run-error.js';
import { normalizeUsage } from '../../ai/usage.js';
import type { ModelRegistryService } from '../../providers/model-registry.service.js';
import type {
  ConversationRepository,
  RunStatusValue,
} from '../../repositories/conversation.repository.js';
import type {
  ContextScope,
  ContextService,
  HistoryMessage,
  SummaryState,
} from '../../services/context.service.js';
import type { QuotaService, QuotaSubject } from '../../services/quota.service.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/app-error.js';
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
  quota: QuotaService;
  clock: Clock;
  logger: FastifyBaseLogger;
};

/**
 * Single-model chat (blueprint §4 request path, §10). `prepare` does every
 * check that can reject the request before streaming starts, so those failures
 * are ordinary JSON errors; `execute` owns the stream and always records how
 * the run ended.
 */
export class ChatService {
  readonly #deps: ChatServiceDeps;

  constructor(deps: ChatServiceDeps) {
    this.#deps = deps;
  }

  async prepare(caller: ChatCaller, input: ChatRequest): Promise<PreparedChat> {
    const { models, conversations, guestChats, context, quota, clock } = this.#deps;
    const { provider, model } = await models.resolve(input.provider, input.model);

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

    if (input.retry) {
      if (history.at(-1)?.role !== 'user') {
        throw new AppError('VALIDATION_ERROR', 'There is no unanswered message to retry.');
      }
    } else {
      history = [...history, { role: 'user', content: input.message as string }];
    }

    const maxOutputTokens = Math.min(model.maxOutputTokens, CHAT_MAX_OUTPUT_TOKENS);
    // Before quota: a request that cannot fit must not use up allowance.
    const plan = await context.plan({
      model,
      systemPrompt: SYSTEM_PROMPT,
      maxOutputTokens,
      history,
      summary,
      historyMayBeTrimmed: caller.kind === 'guest',
    });
    const contextInfo: ChatContextInfo = {
      inputTokens: plan.context.estimatedInputTokens,
      budgetTokens: plan.context.budgetTokens,
      contextWindow: model.contextWindow,
      droppedMessages: plan.context.droppedMessages,
      summaryIncluded: plan.context.summaryIncluded,
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
        if (!input.retry) {
          conversationId ??= (
            await conversations.create({
              userId: caller.userId,
              title: conversationTitle(input.message as string),
            })
          ).id;
          await conversations.addUserMessage(conversationId, input.message as string);
        }
        runId = (
          await conversations.startRun({
            conversationId: conversationId as string,
            provider: model.provider,
            model: model.id,
          })
        ).id;
      } else {
        if (!input.retry) {
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

    const execute = async (signal: AbortSignal, emit: EmitEvent): Promise<void> => {
      const startedAt = performance.now();
      const elapsed = () => Math.round(performance.now() - startedAt);
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

      const record = async (
        status: Exclude<RunStatusValue, 'RUNNING'>,
        errorCode: string | null,
      ) => {
        const keepText = (status === 'COMPLETED' || status === 'CANCELLED') && text.length > 0;
        const latencyMs = elapsed();
        const finalUsage = normalizeUsage(usage, {
          inputTokens: plan.context.estimatedInputTokens,
          outputTokens: estimateTokens(text, plan.charsPerToken),
        });

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
            estimatedCostUsd: estimateCostUsd(model, finalUsage),
            completedAt: clock.now(),
          });
          return { messageId: message?.id ?? null, latencyMs, usage: finalUsage };
        }

        if (keepText) {
          guestMessages = [
            ...guestMessages,
            {
              id: randomUUID(),
              role: 'assistant',
              content: text,
              createdAt: clock.now().toISOString(),
              run: {
                provider: model.provider,
                model: model.id,
                status: toRunStatus(status),
                latencyMs,
              },
            },
          ];
          await guestChats.save(caller.guest, guestMessages);
        }
        return { messageId: null, latencyMs, usage: finalUsage };
      };

      try {
        for await (const chunk of provider.stream({
          model: model.id,
          messages: plan.context.messages,
          maxOutputTokens,
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
          provider,
          model,
          plan,
          providerInputTokens:
            outcome.usage.source === 'provider' ? (outcome.usage.inputTokens ?? null) : null,
        });
      } catch (error) {
        if (signal.aborted) {
          const outcome = await record('CANCELLED', null).catch((recordError: unknown) => {
            this.#deps.logger.error({ err: recordError, runId }, 'failed to record cancelled run');
            return { messageId: null, latencyMs: elapsed() };
          });
          if (!text) await quota.refund(subject, ipHash ? { ipHash } : {}).catch(() => undefined);
          emit({
            event: 'message.done',
            data: {
              runId,
              status: 'cancelled',
              messageId: outcome.messageId,
              latencyMs: outcome.latencyMs,
            },
          });
          return;
        }

        const runError = this.#toRunError(error, runId);
        // Nothing was produced: the attempt should not use up daily allowance.
        if (!text) await quota.refund(subject, ipHash ? { ipHash } : {}).catch(() => undefined);
        await record(
          runError.code === 'PROVIDER_TIMEOUT' ? 'TIMEOUT' : 'FAILED',
          runError.code,
        ).catch((recordError: unknown) => {
          this.#deps.logger.error({ err: recordError, runId }, 'failed to record failed run');
        });
        emit({ event: 'error', data: { runId, ...runError } });
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
