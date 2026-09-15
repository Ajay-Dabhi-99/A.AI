import { AIProviderError, type AIProviderErrorOptions } from '@a-ai/ai-core';
import type { ChatStreamEvent } from '@a-ai/shared-types';
import { describe, expect, it } from 'vitest';
import type { RetryPolicy } from '../../src/ai/retry-policy.js';
import { TokenService } from '../../src/ai/token.service.js';
import { ChatService, type ChatCaller } from '../../src/modules/chat/chat.service.js';
import { GuestConversationStore } from '../../src/modules/chat/guest-conversation.store.js';
import { GuestService } from '../../src/modules/guest/guest.service.js';
import { createAdapterRegistry, registryDefaults } from '../../src/providers/model-directory.js';
import { ModelRegistryService } from '../../src/providers/model-registry.service.js';
import { ProviderHealthService } from '../../src/providers/provider-health.service.js';
import { ContextService } from '../../src/services/context.service.js';
import { createRedisStore } from '../../src/services/kv-store.js';
import { QuotaService } from '../../src/services/quota.service.js';
import { noAttachments, silentLogger, TestClock } from '../helpers/fakes.js';
import { createMemoryConversations } from '../helpers/memory-conversations.js';
import { createMemoryModelRegistry } from '../helpers/memory-model-registry.js';
import { ScriptedProvider, testModel, type ScriptStep } from '../helpers/scripted-provider.js';
import { controlledRedis } from '../helpers/test-app.js';

const USER: ChatCaller = { kind: 'user', userId: 'user-1' };
const say = (text: string): ScriptStep => ({ type: 'delta', text });
const done: ScriptStep = { type: 'done', finishReason: 'stop' };
const fail = (
  options: Omit<AIProviderErrorOptions, 'provider' | 'message'>,
  provider = 'alpha',
) => ({
  type: 'throw' as const,
  error: new AIProviderError({ provider, message: `${provider} ${options.code}`, ...options }),
});

function setup(
  options: {
    fallbackEnabled?: boolean;
    retryPolicy?: Partial<RetryPolicy>;
    betaModel?: Parameters<typeof testModel>[2];
  } = {},
) {
  const store = createRedisStore(controlledRedis());
  const clock = new TestClock();
  const logger = silentLogger();
  const conversations = createMemoryConversations();
  const alpha = new ScriptedProvider('alpha', [say('Alpha answer'), done]);
  const beta = new ScriptedProvider('beta', [say('Beta answer'), done]);
  // Registry order: alpha first, then beta.
  const alphaModel = testModel('alpha', 'a-1', { name: 'Alpha One' });
  const betaModel = testModel('beta', 'b-1', { name: 'Beta One', ...options.betaModel });
  const models = new ModelRegistryService({
    repository: createMemoryModelRegistry(),
    adapters: createAdapterRegistry([
      { provider: alpha, models: [alphaModel] },
      { provider: beta, models: [betaModel] },
    ]),
    defaults: registryDefaults([alphaModel, betaModel]),
    providerNames: {},
    clock,
    logger,
  });
  const quota = new QuotaService(store, { guest: 10, user: 10 }, clock);
  const health = new ProviderHealthService({ store, clock });
  const context = new ContextService({
    store,
    conversations,
    tokens: new TokenService(store),
    summarizer: { summarize: async () => 'summary' },
    summariesEnabled: false,
    clock,
    logger,
  });
  const guestChats = new GuestConversationStore(store, clock);
  const chat = new ChatService({
    models,
    conversations,
    guestChats,
    context,
    health,
    quota,
    attachments: noAttachments,
    fallbackEnabled: options.fallbackEnabled ?? true,
    retryPolicy: { backoffMs: 1, rateLimitDelayMs: 1, ...options.retryPolicy },
    clock,
    logger,
  });
  return {
    alpha,
    beta,
    chat,
    conversations,
    guestChats,
    guests: new GuestService(store, 60, clock),
    health,
    quota,
  };
}

type Context = ReturnType<typeof setup>;

async function send(
  ctx: Context,
  caller: ChatCaller = USER,
  control: { abortOn?: (event: ChatStreamEvent) => boolean } = {},
): Promise<ChatStreamEvent[]> {
  const prepared = await ctx.chat.prepare(caller, {
    provider: 'alpha',
    model: 'a-1',
    message: 'Explain RAG',
  });
  const controller = new AbortController();
  const events: ChatStreamEvent[] = [];
  await prepared.execute(controller.signal, (event) => {
    events.push(event);
    if (control.abortOn?.(event)) controller.abort(new DOMException('stop', 'AbortError'));
  });
  return events;
}

const names = (events: ChatStreamEvent[]) => events.map((event) => event.event);
const usedToday = async (ctx: Context) =>
  (await ctx.quota.summary({ kind: 'user', id: 'user-1' })).used;

describe('retrying the chosen model', () => {
  it('retries a timeout once and answers with the same model', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([fail({ code: 'PROVIDER_TIMEOUT' })], [say('Second try'), done]);

    const events = await send(ctx);

    expect(names(events)).toEqual([
      'message.start',
      'message.retry',
      'message.delta',
      'usage',
      'message.done',
    ]);
    expect(events[1]).toMatchObject({ data: { attempt: 2, code: 'PROVIDER_TIMEOUT', delayMs: 1 } });
    expect(ctx.beta.requests).toHaveLength(0);
    expect(ctx.conversations.data.runs[0]).toMatchObject({
      status: 'COMPLETED',
      provider: 'alpha',
      model: 'a-1',
      requestedProvider: null,
      attemptCount: 2,
    });
    expect(await usedToday(ctx)).toBe(1);
  });

  it('never retries or falls back once text has streamed', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([say('Partial'), fail({ code: 'MODEL_UNAVAILABLE', retryable: true })]);

    const events = await send(ctx);

    expect(names(events)).toEqual(['message.start', 'message.delta', 'error']);
    expect(ctx.alpha.requests).toHaveLength(1);
    expect(ctx.beta.requests).toHaveLength(0);
  });

  it('neither retries nor falls back from an unexpected error', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([{ type: 'throw', error: new Error('socket hang up') }]);

    const events = await send(ctx);

    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'INTERNAL_ERROR' } });
    expect(ctx.alpha.requests).toHaveLength(1);
    expect(ctx.beta.requests).toHaveLength(0);
  });
});

describe('falling back to another model', () => {
  it('falls back after the retry also fails, and records who answered and why', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([fail({ code: 'PROVIDER_TIMEOUT' })]);

    const events = await send(ctx);

    expect(names(events)).toEqual([
      'message.start',
      'message.retry',
      'message.fallback',
      'message.delta',
      'usage',
      'message.done',
    ]);
    expect(events[2]).toMatchObject({
      data: {
        from: { provider: 'alpha', model: 'a-1' },
        to: { provider: 'beta', model: 'b-1' },
        code: 'PROVIDER_TIMEOUT',
      },
    });
    const [question, answer] = await ctx.conversations.listMessages(
      ctx.conversations.data.conversations[0]!.id,
    );
    expect(question?.content).toBe('Explain RAG');
    expect(answer).toMatchObject({ content: 'Beta answer' });
    expect(answer?.run).toMatchObject({
      status: 'COMPLETED',
      provider: 'beta',
      model: 'b-1',
      requestedProvider: 'alpha',
      requestedModel: 'a-1',
      fallbackReason: 'PROVIDER_TIMEOUT',
      attemptCount: 3,
    });
    // One chat message uses one message of allowance, however many attempts it took.
    expect(await usedToday(ctx)).toBe(1);
    const [alphaHealth, betaHealth] = await ctx.health.snapshot([
      { id: 'alpha', name: 'Alpha', configured: true },
      { id: 'beta', name: 'Beta', configured: true },
    ]);
    expect(alphaHealth).toMatchObject({ status: 'degraded', consecutiveFailures: 2 });
    expect(betaHealth?.status).toBe('healthy');
  });

  it('falls back at once when a 429 asks to wait too long, and opens the circuit', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([fail({ code: 'RATE_LIMITED', retryAfterSeconds: 30 })]);

    const events = await send(ctx);

    expect(names(events)).not.toContain('message.retry');
    expect(events[1]).toMatchObject({ event: 'message.fallback', data: { code: 'RATE_LIMITED' } });
    expect(ctx.alpha.requests).toHaveLength(1);
    expect(await ctx.health.isDown('alpha')).toBe(true);
  });

  it('falls back without retrying when the key or model is rejected', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([fail({ code: 'MODEL_UNAVAILABLE', retryable: false })]);

    const events = await send(ctx);

    expect(ctx.alpha.requests).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ event: 'message.done', data: { status: 'completed' } });
  });

  it('fails, refunds and records the last model when every candidate fails', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([fail({ code: 'PROVIDER_TIMEOUT' })]);
    ctx.beta.setScripts([fail({ code: 'MODEL_UNAVAILABLE', retryable: true }, 'beta')]);

    const events = await send(ctx);

    expect(names(events)).toEqual(['message.start', 'message.retry', 'message.fallback', 'error']);
    // Fallback models get one attempt.
    expect(ctx.beta.requests).toHaveLength(1);
    expect(ctx.conversations.data.runs[0]).toMatchObject({
      status: 'FAILED',
      provider: 'beta',
      requestedProvider: 'alpha',
      errorCode: 'MODEL_UNAVAILABLE',
      attemptCount: 3,
    });
    expect(await usedToday(ctx)).toBe(0);
  });

  it('only retries when fallback is turned off', async () => {
    const ctx = setup({ fallbackEnabled: false });
    ctx.alpha.setScripts([fail({ code: 'PROVIDER_TIMEOUT' })]);

    const events = await send(ctx);

    expect(names(events)).toEqual(['message.start', 'message.retry', 'error']);
    expect(ctx.beta.requests).toHaveLength(0);
    expect(await usedToday(ctx)).toBe(0);
  });

  it('skips a model the conversation cannot fit', async () => {
    // Beta's reply reservation exceeds its window, so nothing fits it.
    const ctx = setup({ betaModel: { contextWindow: 1_000, maxOutputTokens: 999 } });
    ctx.alpha.setScripts([fail({ code: 'PROVIDER_TIMEOUT' })]);

    const events = await send(ctx);

    expect(names(events)).toEqual(['message.start', 'message.retry', 'error']);
    expect(ctx.beta.requests).toHaveLength(0);
  });

  it('labels a guest reply that another model answered', async () => {
    const ctx = setup();
    ctx.alpha.setScripts([fail({ code: 'PROVIDER_BAD_RESPONSE' })]);
    const guest = await ctx.guests.create();

    await send(ctx, { kind: 'guest', guest, ipHash: 'ip-1' });

    const [, answer] = await ctx.guestChats.get(guest.id);
    expect(answer?.run).toMatchObject({
      provider: 'beta',
      model: 'b-1',
      fallbackFrom: { provider: 'alpha', model: 'a-1' },
    });
  });
});

describe('provider health and cancellation', () => {
  it('skips a provider that is down when another model can answer', async () => {
    const ctx = setup();
    for (let index = 0; index < 3; index++) {
      await ctx.health.recordFailure('alpha', fail({ code: 'PROVIDER_TIMEOUT' }).error);
    }

    const events = await send(ctx);

    expect(ctx.alpha.requests).toHaveLength(0);
    expect(events[1]).toMatchObject({
      event: 'message.fallback',
      data: { code: 'MODEL_UNAVAILABLE', to: { provider: 'beta' } },
    });
  });

  it('still tries the chosen model when every provider is down', async () => {
    const ctx = setup();
    for (const provider of ['alpha', 'beta']) {
      for (let index = 0; index < 3; index++) {
        await ctx.health.recordFailure(
          provider,
          fail({ code: 'PROVIDER_TIMEOUT' }, provider).error,
        );
      }
    }

    const events = await send(ctx);

    expect(ctx.alpha.requests).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ event: 'message.done', data: { status: 'completed' } });
    // The successful probe closes alpha's circuit.
    expect(await ctx.health.isDown('alpha')).toBe(false);
  });

  it('stops during the retry wait without making another call', async () => {
    const ctx = setup({ retryPolicy: { backoffMs: 60_000 } });
    ctx.alpha.setScripts([fail({ code: 'PROVIDER_TIMEOUT' })]);

    const events = await send(ctx, USER, { abortOn: (event) => event.event === 'message.retry' });

    expect(events.at(-1)).toMatchObject({ event: 'message.done', data: { status: 'cancelled' } });
    expect(ctx.alpha.requests).toHaveLength(1);
    expect(ctx.beta.requests).toHaveLength(0);
    expect(ctx.conversations.data.runs[0]?.status).toBe('CANCELLED');
    expect(await usedToday(ctx)).toBe(0);
  });
});
