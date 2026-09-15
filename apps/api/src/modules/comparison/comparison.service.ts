import { randomUUID } from 'node:crypto';
import type { AIProvider } from '@a-ai/ai-core';
import type {
  AIModel,
  AIUsage,
  ComparisonModelRef,
  ComparisonRunInfo,
  ComparisonStreamEvent,
  RunError,
} from '@a-ai/shared-types';
import type { ComparisonRequest, ComparisonRunRequest } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import { buildContext, estimateTokens, type BuiltContext } from '../../ai/context-builder.js';
import { estimateCostUsd } from '../../ai/cost.js';
import { toRunError } from '../../ai/run-error.js';
import type { ModelRegistryService } from '../../providers/model-registry.service.js';
import type {
  ComparisonRepository,
  ComparisonRunCompletion,
} from '../../repositories/comparison.repository.js';
import type { QuotaService, QuotaSubject } from '../../services/quota.service.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/app-error.js';
import { CHAT_MAX_OUTPUT_TOKENS, SYSTEM_PROMPT, type ChatCaller } from '../chat/chat.service.js';
import type { GuestComparisonStore } from './guest-comparison.store.js';

/** A run still going after this long is stopped and reported as PROVIDER_TIMEOUT. */
export const COMPARISON_RUN_TIMEOUT_MS = 120_000;

export type ComparisonLimits = { guest: number; user: number };

export type EmitComparisonEvent = (event: ComparisonStreamEvent) => void;

export type PreparedComparison = {
  comparisonId: string;
  runs: ComparisonRunInfo[];
  /** Runs every model concurrently, streams through `emit` and records each outcome. Never throws. */
  execute(signal: AbortSignal, emit: EmitComparisonEvent): Promise<void>;
};

export type ComparisonServiceDeps = {
  models: ModelRegistryService;
  comparisons: ComparisonRepository;
  guestComparisons: GuestComparisonStore;
  quota: QuotaService;
  limits: ComparisonLimits;
  clock: Clock;
  logger: FastifyBaseLogger;
  runTimeoutMs?: number;
};

type Target = {
  provider: AIProvider;
  model: AIModel;
  context: BuiltContext;
  maxOutputTokens: number;
};

type PlannedRun = Target & { runId: string };

const NOT_FOUND_MESSAGE = 'This comparison does not exist or has expired.';

function quotaArgs(caller: ChatCaller): { subject: QuotaSubject; options: { ipHash?: string } } {
  return caller.kind === 'user'
    ? { subject: { kind: 'user', id: caller.userId }, options: {} }
    : { subject: { kind: 'guest', id: caller.guest.id }, options: { ipHash: caller.ipHash } };
}

/**
 * Model comparison (blueprint §11, ADR-011). `prepare` validates every model,
 * the prompt against each model's context and the caller's allowance before
 * any run starts, so those failures are ordinary JSON errors. `execute` runs
 * the models concurrently; a run that fails or times out is reported for that
 * column only, and there is never a fallback to another model.
 */
export class ComparisonService {
  readonly #deps: ComparisonServiceDeps;
  readonly #runTimeoutMs: number;

  constructor(deps: ComparisonServiceDeps) {
    this.#deps = deps;
    this.#runTimeoutMs = deps.runTimeoutMs ?? COMPARISON_RUN_TIMEOUT_MS;
  }

  maxModels(kind: ChatCaller['kind']): number {
    return this.#deps.limits[kind];
  }

  async prepare(caller: ChatCaller, input: ComparisonRequest): Promise<PreparedComparison> {
    const requestStartedAt = performance.now();
    const limit = this.maxModels(caller.kind);
    if (input.models.length > limit) {
      throw new AppError(
        'VALIDATION_ERROR',
        caller.kind === 'guest'
          ? `Guests can compare up to ${limit} models at once. Create a free account to compare more.`
          : `You can compare up to ${limit} models at once.`,
        { details: [{ path: 'models', message: `Choose at most ${limit} models` }] },
      );
    }

    const targets = await this.#plan(input.prompt, input.models);
    await this.#consume(caller, targets.length);

    let comparisonId: string;
    let runIds: string[];
    try {
      if (caller.kind === 'user') {
        const created = await this.#deps.comparisons.create({
          userId: caller.userId,
          prompt: input.prompt,
          runs: targets.map(({ model }) => ({ provider: model.provider, model: model.id })),
        });
        comparisonId = created.comparison.id;
        runIds = created.runs.map((run) => run.id);
      } else {
        comparisonId = (await this.#deps.guestComparisons.create(caller.guest, input.prompt)).id;
        runIds = targets.map(() => randomUUID());
      }
    } catch (error) {
      await this.#refund(caller, targets.length);
      throw error;
    }

    return this.#prepared(
      caller,
      comparisonId,
      requestStartedAt,
      targets.map((target, index) => ({ ...target, runId: runIds[index] as string })),
    );
  }

  /** Runs an existing comparison's prompt on one model again. The earlier run keeps its outcome. */
  async prepareRun(
    caller: ChatCaller,
    comparisonId: string,
    input: ComparisonRunRequest,
  ): Promise<PreparedComparison> {
    const requestStartedAt = performance.now();
    const prompt =
      caller.kind === 'user'
        ? (await this.#deps.comparisons.findForUser(comparisonId, caller.userId))?.prompt
        : (await this.#deps.guestComparisons.find(comparisonId, caller.guest.id))?.prompt;
    if (prompt === undefined) throw new AppError('NOT_FOUND', NOT_FOUND_MESSAGE);

    const [target] = (await this.#plan(prompt, [input])) as [Target];
    await this.#consume(caller, 1);

    let runId: string;
    try {
      runId =
        caller.kind === 'user'
          ? (
              await this.#deps.comparisons.addRun(comparisonId, {
                provider: target.model.provider,
                model: target.model.id,
              })
            ).id
          : randomUUID();
    } catch (error) {
      await this.#refund(caller, 1);
      throw error;
    }

    return this.#prepared(caller, comparisonId, requestStartedAt, [{ ...target, runId }]);
  }

  /** Resolves every model and fits the prompt to each, naming the model that fails. */
  async #plan(prompt: string, refs: ComparisonModelRef[]): Promise<Target[]> {
    const targets: Target[] = [];
    for (const [index, ref] of refs.entries()) {
      let resolved: { provider: AIProvider; model: AIModel };
      try {
        resolved = await this.#deps.models.resolve(ref.provider, ref.model);
      } catch (error) {
        if (error instanceof AppError && error.code === 'MODEL_UNAVAILABLE') {
          throw new AppError(
            'MODEL_UNAVAILABLE',
            `${ref.model} is not available. Remove it from the comparison and try again.`,
            {
              statusCode: 400,
              retryable: false,
              details: [{ path: `models.${index}`, message: 'Not available' }],
            },
          );
        }
        throw error;
      }

      const { provider, model } = resolved;
      const maxOutputTokens = Math.min(model.maxOutputTokens, CHAT_MAX_OUTPUT_TOKENS);
      let context: BuiltContext;
      try {
        context = buildContext({
          systemPrompt: SYSTEM_PROMPT,
          history: [{ role: 'user', content: prompt }],
          contextWindow: model.contextWindow,
          maxOutputTokens,
        });
      } catch (error) {
        if (error instanceof AppError && error.code === 'CONTEXT_TOO_LARGE') {
          throw new AppError(
            'CONTEXT_TOO_LARGE',
            `The prompt is too long for ${model.name}. Shorten it or remove that model.`,
            { details: [{ path: `models.${index}`, message: 'Prompt too long for this model' }] },
          );
        }
        throw error;
      }
      targets.push({ provider, model, context, maxOutputTokens });
    }
    return targets;
  }

  /** One message of allowance per model. All or nothing: a shortfall gives back what was taken. */
  async #consume(caller: ChatCaller, count: number): Promise<void> {
    const { subject, options } = quotaArgs(caller);
    let consumed = 0;
    try {
      while (consumed < count) {
        await this.#deps.quota.consume(subject, options);
        consumed += 1;
      }
    } catch (error) {
      await this.#refund(caller, consumed);
      if (error instanceof AppError && error.code === 'QUOTA_EXCEEDED' && count > 1) {
        throw new AppError(
          'QUOTA_EXCEEDED',
          `Comparing ${count} models uses ${count} messages, and not enough are left today. Choose fewer models or wait for the reset at midnight UTC.`,
          error.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: error.retryAfterSeconds },
        );
      }
      throw error;
    }
  }

  async #refund(caller: ChatCaller, count: number): Promise<void> {
    const { subject, options } = quotaArgs(caller);
    for (let index = 0; index < count; index++) {
      await this.#deps.quota.refund(subject, options).catch((error: unknown) => {
        this.#deps.logger.warn({ err: error }, 'quota refund failed');
      });
    }
  }

  #prepared(
    caller: ChatCaller,
    comparisonId: string,
    requestStartedAt: number,
    planned: PlannedRun[],
  ): PreparedComparison {
    const runs = planned.map(({ runId, model }) => ({
      runId,
      provider: model.provider,
      model: model.id,
    }));

    return {
      comparisonId,
      runs,
      execute: async (signal, emit) => {
        emit({ event: 'comparison.start', data: { comparisonId, runs } });
        // allSettled, never all: one run failing in any way must not stop its siblings.
        const outcomes = await Promise.allSettled(
          planned.map((run) => this.#execute(caller, run, requestStartedAt, signal, emit)),
        );
        for (const [index, outcome] of outcomes.entries()) {
          if (outcome.status === 'rejected') {
            this.#deps.logger.error(
              { err: outcome.reason, runId: planned[index]?.runId },
              'comparison run crashed',
            );
          }
        }
        emit({ event: 'comparison.done', data: { comparisonId } });
      },
    };
  }

  async #execute(
    caller: ChatCaller,
    run: PlannedRun,
    requestStartedAt: number,
    requestSignal: AbortSignal,
    emit: EmitComparisonEvent,
  ): Promise<void> {
    const { runId, provider, model, context, maxOutputTokens } = run;
    const { comparisons, clock, logger } = this.#deps;
    const elapsed = () => Math.round(performance.now() - requestStartedAt);

    // One controller per run: the request's abort reaches every run, a timeout only this one.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException(`${model.name} timed out`, 'TimeoutError'));
    }, this.#runTimeoutMs);
    const forwardAbort = () => controller.abort(requestSignal.reason);
    if (requestSignal.aborted) forwardAbort();
    else requestSignal.addEventListener('abort', forwardAbort, { once: true });

    let ttftMs: number | null = null;
    let text = '';
    let usage: AIUsage | null = null;

    const record = async (
      status: ComparisonRunCompletion['status'],
      errorCode: string | null,
      latencyMs: number,
      content: string | null,
    ) => {
      const finalUsage: AIUsage = usage ?? {
        source: 'estimated',
        inputTokens: context.estimatedInputTokens,
        outputTokens: estimateTokens(text),
      };
      const estimatedCostUsd = estimateCostUsd(model, finalUsage);
      if (caller.kind === 'user') {
        await comparisons
          .completeRun(runId, {
            status,
            content,
            ttftMs,
            latencyMs,
            inputTokens: finalUsage.inputTokens ?? null,
            outputTokens: finalUsage.outputTokens ?? null,
            usageSource: finalUsage.source,
            errorCode,
            estimatedCostUsd,
            completedAt: clock.now(),
          })
          .catch((error: unknown) => {
            logger.error({ err: error, runId }, 'failed to record comparison run');
          });
      }
      return { usage: finalUsage, estimatedCostUsd };
    };

    try {
      for await (const chunk of provider.stream({
        model: model.id,
        messages: context.messages,
        maxOutputTokens,
        signal: controller.signal,
      })) {
        if (chunk.type === 'delta') {
          ttftMs ??= elapsed();
          text += chunk.text;
          emit({ event: 'message.delta', data: { runId, text: chunk.text } });
        } else if (chunk.type === 'usage') {
          usage = chunk.usage;
        }
      }
      // An adapter that ends quietly after an abort must not be reported as a finished answer.
      if (controller.signal.aborted) throw controller.signal.reason;

      const latencyMs = elapsed();
      const outcome = await record('COMPLETED', null, latencyMs, text || null);
      emit({ event: 'usage', data: { runId, usage: outcome.usage } });
      emit({
        event: 'message.done',
        data: {
          runId,
          status: 'completed',
          latencyMs,
          ttftMs,
          estimatedCost: outcome.estimatedCostUsd,
        },
      });
    } catch (error) {
      const latencyMs = elapsed();
      // Nothing was produced: this run should not use up daily allowance.
      if (!text) await this.#refund(caller, 1);

      if (requestSignal.aborted && !timedOut) {
        const outcome = await record('CANCELLED', null, latencyMs, text || null);
        emit({
          event: 'message.done',
          data: {
            runId,
            status: 'cancelled',
            latencyMs,
            ttftMs,
            estimatedCost: outcome.estimatedCostUsd,
          },
        });
        return;
      }

      const runError: RunError = timedOut
        ? {
            code: 'PROVIDER_TIMEOUT',
            message: `${model.name} did not finish within ${Math.max(1, Math.ceil(this.#runTimeoutMs / 1000))} seconds.`,
            retryable: true,
          }
        : toRunError(error, (unexpected) => {
            logger.error({ err: unexpected, runId }, 'unexpected comparison failure');
          });
      const status = runError.code === 'PROVIDER_TIMEOUT' ? 'TIMEOUT' : 'FAILED';
      // Partial output from a failed run is discarded, as in chat.
      await record(status, runError.code, latencyMs, null);
      emit({
        event: 'error',
        data: {
          runId,
          status: status === 'TIMEOUT' ? 'timeout' : 'failed',
          latencyMs,
          ...runError,
        },
      });
    } finally {
      clearTimeout(timer);
      requestSignal.removeEventListener('abort', forwardAbort);
    }
  }
}
