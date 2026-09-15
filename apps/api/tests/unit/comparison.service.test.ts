import { AIProviderError } from '@a-ai/ai-core';
import type { ComparisonStreamEvent } from '@a-ai/shared-types';
import { describe, expect, it } from 'vitest';
import type { ChatCaller } from '../../src/modules/chat/chat.service.js';
import {
  ComparisonService,
  type ComparisonLimits,
  type PreparedComparison,
} from '../../src/modules/comparison/comparison.service.js';
import { GuestComparisonStore } from '../../src/modules/comparison/guest-comparison.store.js';
import { GuestService } from '../../src/modules/guest/guest.service.js';
import { createAdapterRegistry, registryDefaults } from '../../src/providers/model-directory.js';
import { ModelRegistryService } from '../../src/providers/model-registry.service.js';
import { createRedisStore } from '../../src/services/kv-store.js';
import { QuotaService } from '../../src/services/quota.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { silentLogger, TestClock } from '../helpers/fakes.js';
import { createMemoryComparisons } from '../helpers/memory-comparisons.js';
import { createMemoryModelRegistry } from '../helpers/memory-model-registry.js';
import { ScriptedProvider, testModel, type ScriptStep } from '../helpers/scripted-provider.js';
import { controlledRedis } from '../helpers/test-app.js';

const USER: ChatCaller = { kind: 'user', userId: 'user-1' };
const say = (text: string): ScriptStep => ({ type: 'delta', text });
const done: ScriptStep = { type: 'done', finishReason: 'stop' };
const providerUsage: ScriptStep = {
  type: 'usage',
  usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, source: 'provider' },
};
const ALPHA = { provider: 'alpha', model: 'a-1' };
const BETA = { provider: 'beta', model: 'b-1' };
const GAMMA = { provider: 'gamma', model: 'g-1' };

function setup(
  options: { limits?: ComparisonLimits; dailyLimit?: number; runTimeoutMs?: number } = {},
) {
  const store = createRedisStore(controlledRedis());
  const clock = new TestClock();
  const logger = silentLogger();
  const dailyLimit = options.dailyLimit ?? 10;
  const quota = new QuotaService(store, { guest: dailyLimit, user: dailyLimit }, clock);
  const guests = new GuestService(store, 60, clock);
  const comparisons = createMemoryComparisons();
  const alpha = new ScriptedProvider('alpha', [say('Alpha'), providerUsage, done]);
  const beta = new ScriptedProvider('beta', [say('Beta'), done]);
  const gamma = new ScriptedProvider('gamma', [say('Gamma'), done]);
  const models = [
    testModel('alpha', 'a-1', {
      name: 'Alpha One',
      inputPricePerMillionUsd: 1,
      outputPricePerMillionUsd: 2,
    }),
    testModel('beta', 'b-1', { name: 'Beta One' }),
    testModel('gamma', 'g-1', { name: 'Gamma Small', contextWindow: 300, maxOutputTokens: 50 }),
  ];
  const entries = [alpha, beta, gamma].map((provider, index) => ({
    provider,
    models: [models[index]!],
  }));
  const registry = new ModelRegistryService({
    repository: createMemoryModelRegistry(),
    adapters: createAdapterRegistry(entries),
    defaults: registryDefaults(models),
    providerNames: {},
    clock,
    logger,
  });
  const service = new ComparisonService({
    models: registry,
    comparisons,
    guestComparisons: new GuestComparisonStore(store, clock),
    quota,
    limits: options.limits ?? { guest: 2, user: 4 },
    clock,
    logger,
    runTimeoutMs: options.runTimeoutMs ?? 5_000,
  });
  return { quota, guests, comparisons, alpha, beta, gamma, service };
}

type Context = ReturnType<typeof setup>;

async function execute(
  prepared: PreparedComparison,
  control: { abortOnFirstDelta?: boolean } = {},
): Promise<ComparisonStreamEvent[]> {
  const controller = new AbortController();
  const events: ComparisonStreamEvent[] = [];
  await prepared.execute(controller.signal, (event) => {
    events.push(event);
    if (control.abortOnFirstDelta && event.event === 'message.delta') {
      controller.abort(new DOMException('Stopped by the user', 'AbortError'));
    }
  });
  return events;
}

function terminalEvents(events: ComparisonStreamEvent[], runId: string) {
  return events.filter(
    (event) =>
      (event.event === 'message.done' || event.event === 'error') && event.data.runId === runId,
  );
}

async function usedToday(ctx: Context, caller: ChatCaller = USER): Promise<number> {
  const subject =
    caller.kind === 'user'
      ? { kind: 'user' as const, id: caller.userId }
      : { kind: 'guest' as const, id: caller.guest.id };
  return (await ctx.quota.summary(subject)).used;
}

const prompt = { prompt: 'Explain vector databases' };

describe('ComparisonService execution', () => {
  it('runs every model concurrently and multiplexes the events by run', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([{ type: 'wait', ms: 40 }, say('Alpha'), providerUsage, done]);

    const prepared = await ctx.service.prepare(USER, { ...prompt, models: [ALPHA, BETA] });
    const [alphaRun, betaRun] = prepared.runs;
    const events = await execute(prepared);

    expect(events[0]).toEqual({
      event: 'comparison.start',
      data: {
        comparisonId: prepared.comparisonId,
        runs: [
          { runId: alphaRun!.runId, provider: 'alpha', model: 'a-1' },
          { runId: betaRun!.runId, provider: 'beta', model: 'b-1' },
        ],
      },
    });
    expect(events.at(-1)).toEqual({
      event: 'comparison.done',
      data: { comparisonId: prepared.comparisonId },
    });

    // The fast model finished while the slow one was still waiting: runs are not serialized.
    const doneOrder = events
      .filter((event) => event.event === 'message.done')
      .map((event) => event.data.runId);
    expect(doneOrder).toEqual([betaRun!.runId, alphaRun!.runId]);
    expect(terminalEvents(events, alphaRun!.runId)).toHaveLength(1);
    expect(terminalEvents(events, betaRun!.runId)).toHaveLength(1);

    const usage = events.filter((event) => event.event === 'usage');
    expect(usage.find((event) => event.data.runId === alphaRun!.runId)?.data.usage.source).toBe(
      'provider',
    );
    expect(usage.find((event) => event.data.runId === betaRun!.runId)?.data.usage.source).toBe(
      'estimated',
    );
    expect(
      events.find(
        (event) => event.event === 'message.done' && event.data.runId === alphaRun!.runId,
      ),
    ).toMatchObject({ data: { status: 'completed', estimatedCost: 0.00003 } });

    expect(
      ctx.comparisons.data.runs.map((run) => [run.status, run.content, run.usageSource]),
    ).toEqual([
      ['COMPLETED', 'Alpha', 'provider'],
      ['COMPLETED', 'Beta', 'estimated'],
    ]);
    expect(ctx.comparisons.data.runs[0]?.latencyMs).toBeGreaterThanOrEqual(35);
    expect(await usedToday(ctx)).toBe(2);
  });

  it('reports a failed run for its column only and gives back its allowance', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([
      {
        type: 'throw',
        error: new AIProviderError({
          provider: 'alpha',
          code: 'RATE_LIMITED',
          message: 'Alpha is rate limiting requests',
        }),
      },
    ]);

    const prepared = await ctx.service.prepare(USER, { ...prompt, models: [ALPHA, BETA] });
    const [alphaRun, betaRun] = prepared.runs;
    const events = await execute(prepared);

    expect(terminalEvents(events, alphaRun!.runId)).toEqual([
      {
        event: 'error',
        data: expect.objectContaining({
          runId: alphaRun!.runId,
          status: 'failed',
          code: 'RATE_LIMITED',
          message: 'Alpha is rate limiting requests',
          retryable: true,
        }),
      },
    ]);
    expect(terminalEvents(events, betaRun!.runId)).toEqual([
      expect.objectContaining({
        event: 'message.done',
        data: expect.objectContaining({ status: 'completed' }),
      }),
    ]);
    expect(ctx.comparisons.data.runs[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'RATE_LIMITED',
      content: null,
    });
    expect(await usedToday(ctx)).toBe(1);
  });

  it('discards partial output of a failed run and never leaks an unexpected error', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([
      say('partial'),
      { type: 'throw', error: new Error('key sk-123 leaked') },
    ]);

    const prepared = await ctx.service.prepare(USER, { ...prompt, models: [ALPHA, BETA] });
    const events = await execute(prepared);
    const failure = terminalEvents(events, prepared.runs[0]!.runId)[0];

    expect(failure).toMatchObject({ event: 'error', data: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(failure)).not.toContain('sk-123');
    expect(ctx.comparisons.data.runs[0]).toMatchObject({ status: 'FAILED', content: null });
    // Output was produced, so that model's message is not refunded.
    expect(await usedToday(ctx)).toBe(2);
  });

  it('times out a slow run without waiting for it or stopping the others', async () => {
    const ctx = setup({ runTimeoutMs: 50 });
    ctx.alpha.setScripts([{ type: 'hang' }]);

    const prepared = await ctx.service.prepare(USER, { ...prompt, models: [ALPHA, BETA] });
    const [alphaRun, betaRun] = prepared.runs;
    const events = await execute(prepared);

    expect(terminalEvents(events, alphaRun!.runId)[0]).toMatchObject({
      event: 'error',
      data: { status: 'timeout', code: 'PROVIDER_TIMEOUT', retryable: true },
    });
    expect(JSON.stringify(terminalEvents(events, alphaRun!.runId))).toContain('Alpha One');
    expect(terminalEvents(events, betaRun!.runId)[0]).toMatchObject({
      event: 'message.done',
      data: { status: 'completed' },
    });
    expect(ctx.comparisons.data.runs.map((run) => run.status)).toEqual(['TIMEOUT', 'COMPLETED']);
    expect(await usedToday(ctx)).toBe(1);
  });

  it('cancels every run when the request is aborted and keeps partial answers', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([say('Al'), { type: 'hang' }]);
    ctx.beta.setScripts([{ type: 'hang' }]);

    const prepared = await ctx.service.prepare(USER, { ...prompt, models: [ALPHA, BETA] });
    const events = await execute(prepared, { abortOnFirstDelta: true });

    const statuses = events
      .filter((event) => event.event === 'message.done')
      .map((event) => event.data.status);
    expect(statuses).toEqual(['cancelled', 'cancelled']);
    expect(events.at(-1)?.event).toBe('comparison.done');
    expect(ctx.comparisons.data.runs.map((run) => [run.status, run.content])).toEqual([
      ['CANCELLED', 'Al'],
      ['CANCELLED', null],
    ]);
    // Beta produced nothing and is refunded; Alpha had started answering.
    expect(await usedToday(ctx)).toBe(1);
  });
});

describe('ComparisonService validation before any run', () => {
  it('rejects the whole comparison when one model cannot fit the prompt', async () => {
    const ctx = setup();
    const error = await ctx.service
      .prepare(USER, { prompt: 'x'.repeat(4_000), models: [ALPHA, GAMMA] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'CONTEXT_TOO_LARGE', statusCode: 422 });
    expect((error as AppError).message).toContain('Gamma Small');
    expect(ctx.alpha.requests).toHaveLength(0);
    expect(ctx.comparisons.data.comparisons).toHaveLength(0);
    expect(await usedToday(ctx)).toBe(0);
  });

  it('names an unavailable model and starts nothing', async () => {
    const ctx = setup();
    const error = await ctx.service
      .prepare(USER, { ...prompt, models: [ALPHA, { provider: 'alpha', model: 'retired' }] })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'MODEL_UNAVAILABLE',
      statusCode: 400,
      details: [{ path: 'models.1', message: 'Not available' }],
    });
    expect(await usedToday(ctx)).toBe(0);
  });

  it('limits guests to fewer models than users', async () => {
    const ctx = setup();
    const guest = await ctx.guests.create();
    const guestCaller: ChatCaller = { kind: 'guest', guest, ipHash: 'ip-1' };

    await expect(
      ctx.service.prepare(guestCaller, { ...prompt, models: [ALPHA, BETA, GAMMA] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringMatching(/^Guests can compare up to 2/),
    });
    await expect(
      ctx.service.prepare(USER, { ...prompt, models: [ALPHA, BETA, GAMMA] }),
    ).resolves.toMatchObject({ runs: expect.any(Array) });
    expect(ctx.service.maxModels('guest')).toBe(2);
    expect(ctx.service.maxModels('user')).toBe(4);
  });

  it('takes one message per model, all or nothing', async () => {
    const ctx = setup({ dailyLimit: 3 });
    await ctx.service.prepare(USER, { ...prompt, models: [ALPHA, BETA] });
    expect(await usedToday(ctx)).toBe(2);

    await expect(
      ctx.service.prepare(USER, { ...prompt, models: [ALPHA, BETA] }),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      message: expect.stringContaining('Comparing 2 models uses 2 messages'),
      retryAfterSeconds: expect.any(Number),
    });
    expect(await usedToday(ctx)).toBe(2);
  });
});

describe('ComparisonService retries', () => {
  it("adds a run to a user's comparison and refuses anyone else's", async () => {
    const ctx = setup();
    ctx.alpha.setScripts(
      [
        {
          type: 'throw',
          error: new AIProviderError({
            provider: 'alpha',
            code: 'PROVIDER_TIMEOUT',
            message: 'slow',
          }),
        },
      ],
      [say('Second try'), done],
    );
    const first = await ctx.service.prepare(USER, { ...prompt, models: [ALPHA, BETA] });
    await execute(first);

    const retry = await ctx.service.prepareRun(USER, first.comparisonId, ALPHA);
    const events = await execute(retry);

    expect(retry.runs).toEqual([{ runId: expect.any(String), provider: 'alpha', model: 'a-1' }]);
    expect(events.at(-2)).toMatchObject({ event: 'message.done', data: { status: 'completed' } });
    expect(ctx.alpha.requests.at(-1)?.messages.at(-1)?.content).toBe('Explain vector databases');
    expect(
      (await ctx.comparisons.listRuns(first.comparisonId)).map((run) => [run.position, run.status]),
    ).toEqual([
      [0, 'TIMEOUT'],
      [1, 'COMPLETED'],
      [2, 'COMPLETED'],
    ]);

    await expect(
      ctx.service.prepareRun({ kind: 'user', userId: 'someone-else' }, first.comparisonId, ALPHA),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("retries a guest's comparison only for that guest", async () => {
    const ctx = setup();
    const owner: ChatCaller = { kind: 'guest', guest: await ctx.guests.create(), ipHash: 'ip-1' };
    const other: ChatCaller = { kind: 'guest', guest: await ctx.guests.create(), ipHash: 'ip-2' };

    const first = await ctx.service.prepare(owner, { ...prompt, models: [ALPHA, BETA] });
    await execute(first);

    const retry = await ctx.service.prepareRun(owner, first.comparisonId, BETA);
    expect((await execute(retry)).at(-1)?.event).toBe('comparison.done');
    await expect(ctx.service.prepareRun(other, first.comparisonId, BETA)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // Guests have no saved history.
    expect(ctx.comparisons.data.comparisons).toHaveLength(0);
  });
});
