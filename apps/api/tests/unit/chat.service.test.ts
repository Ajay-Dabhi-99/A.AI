import { AIProviderError } from '@a-ai/ai-core';
import type { ChatStreamEvent } from '@a-ai/shared-types';
import { describe, expect, it } from 'vitest';
import {
  ChatService,
  SYSTEM_PROMPT,
  type ChatCaller,
} from '../../src/modules/chat/chat.service.js';
import { ModelSummarizer } from '../../src/ai/summarizer.js';
import { TokenService } from '../../src/ai/token.service.js';
import { GuestConversationStore } from '../../src/modules/chat/guest-conversation.store.js';
import { ContextService } from '../../src/services/context.service.js';
import { ProviderHealthService } from '../../src/providers/provider-health.service.js';
import { GuestService } from '../../src/modules/guest/guest.service.js';
import { createAdapterRegistry, registryDefaults } from '../../src/providers/model-directory.js';
import { ModelRegistryService } from '../../src/providers/model-registry.service.js';
import { createMemoryModelRegistry } from '../helpers/memory-model-registry.js';
import { createRedisStore } from '../../src/services/kv-store.js';
import { QuotaService } from '../../src/services/quota.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { silentLogger, TestClock } from '../helpers/fakes.js';
import { createMemoryConversations } from '../helpers/memory-conversations.js';
import { ScriptedProvider, testModel, type ScriptStep } from '../helpers/scripted-provider.js';
import { controlledRedis } from '../helpers/test-app.js';

const USER: ChatCaller = { kind: 'user', userId: 'user-1' };
const say = (text: string): ScriptStep => ({ type: 'delta', text });
const done: ScriptStep = { type: 'done', finishReason: 'stop' };
const providerUsage: ScriptStep = {
  type: 'usage',
  usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, source: 'provider' },
};

function setup(options: { contextWindow?: number } = {}) {
  const store = createRedisStore(controlledRedis());
  const clock = new TestClock();
  const logger = silentLogger();
  const quota = new QuotaService(store, { guest: 5, user: 5 }, clock);
  const guestChats = new GuestConversationStore(store, clock);
  const guests = new GuestService(store, 60, clock);
  const conversations = createMemoryConversations();
  const provider = new ScriptedProvider('scripted', [
    say('Hello'),
    say(' there'),
    providerUsage,
    done,
  ]);
  const model = testModel(
    'scripted',
    'fast-1',
    options.contextWindow ? { contextWindow: options.contextWindow, maxOutputTokens: 50 } : {},
  );
  const entries = [{ provider, models: [model] }];
  const registry = createMemoryModelRegistry();
  const models = new ModelRegistryService({
    repository: registry,
    adapters: createAdapterRegistry(entries),
    defaults: registryDefaults([model]),
    providerNames: {},
    clock,
    logger,
  });
  const context = new ContextService({
    store,
    conversations,
    tokens: new TokenService(store),
    summarizer: new ModelSummarizer(),
    summariesEnabled: true,
    clock,
    logger,
  });
  const chat = new ChatService({
    models,
    conversations,
    guestChats,
    context,
    health: new ProviderHealthService({ store, clock }),
    fallbackEnabled: true,
    retryPolicy: { backoffMs: 1, rateLimitDelayMs: 1 },
    quota,
    clock,
    logger,
  });
  return {
    store,
    clock,
    logger,
    quota,
    guestChats,
    guests,
    conversations,
    provider,
    chat,
    models,
    registry,
  };
}

type Context = ReturnType<typeof setup>;

async function run(
  ctx: Context,
  caller: ChatCaller,
  body: { message?: string; retry?: boolean; conversationId?: string },
  control: { abortAfterFirstDelta?: boolean } = {},
): Promise<ChatStreamEvent[]> {
  const prepared = await ctx.chat.prepare(caller, {
    provider: 'scripted',
    model: 'fast-1',
    ...body,
  } as Parameters<ChatService['prepare']>[1]);
  const controller = new AbortController();
  const events: ChatStreamEvent[] = [];
  await prepared.execute(controller.signal, (event) => {
    events.push(event);
    if (control.abortAfterFirstDelta && event.event === 'message.delta') {
      controller.abort(new DOMException('stop', 'AbortError'));
    }
  });
  return events;
}

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AppError)) throw new Error(`expected AppError, got ${String(error)}`);
  return error;
}

describe('ChatService for signed-in users', () => {
  it('streams the answer and saves the conversation, both messages and the run', async () => {
    const ctx = setup();
    const events = await run(ctx, USER, { message: 'Explain   vector databases' });

    expect(events.map((event) => event.event)).toEqual([
      'message.start',
      'message.delta',
      'message.delta',
      'usage',
      'message.done',
    ]);
    const [conversation] = ctx.conversations.data.conversations;
    expect(conversation).toMatchObject({ userId: 'user-1', title: 'Explain vector databases' });
    expect(events[0]).toMatchObject({
      data: { conversationId: conversation?.id, provider: 'scripted' },
    });

    const messages = await ctx.conversations.listMessages(conversation!.id);
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ['USER', 'Explain   vector databases'],
      ['ASSISTANT', 'Hello there'],
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({
      event: 'message.done',
      data: { status: 'completed', messageId: messages[1]?.id },
    });
    expect(messages[1]?.run).toMatchObject({
      status: 'COMPLETED',
      inputTokens: 20,
      outputTokens: 5,
      usageSource: 'provider',
      errorCode: null,
    });
    expect(messages[1]?.run?.ttftMs).toBeGreaterThanOrEqual(0);
    expect((await ctx.quota.summary({ kind: 'user', id: 'user-1' })).used).toBe(1);
  });

  it('labels usage as estimated when the provider reports none', async () => {
    const ctx = setup();
    ctx.provider.setScripts([say('Hi'), done]);
    const events = await run(ctx, USER, { message: 'hello' });
    expect(events.find((event) => event.event === 'usage')).toMatchObject({
      data: { usage: { source: 'estimated', outputTokens: 1 } },
    });
    expect(ctx.conversations.data.runs[0]).toMatchObject({ usageSource: 'estimated' });
  });

  it('sends the system prompt and earlier turns with a follow-up question', async () => {
    const ctx = setup();
    await run(ctx, USER, { message: 'first question' });
    const conversationId = ctx.conversations.data.conversations[0]!.id;
    await run(ctx, USER, { message: 'follow-up', conversationId });

    expect(ctx.provider.requests[1]?.messages).toEqual([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'Hello there' },
      { role: 'user', content: 'follow-up' },
    ]);
    expect(ctx.provider.requests[1]?.maxOutputTokens).toBe(4_096);
  });

  it("refuses someone else's conversation", async () => {
    const ctx = setup();
    await run(ctx, USER, { message: 'mine' });
    const conversationId = ctx.conversations.data.conversations[0]!.id;
    const error = await appError(
      ctx.chat.prepare(
        { kind: 'user', userId: 'intruder' },
        { provider: 'scripted', model: 'fast-1', message: 'hi', conversationId },
      ),
    );
    expect(error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  it('rejects an unknown model before using any allowance', async () => {
    const ctx = setup();
    const error = await appError(
      ctx.chat.prepare(USER, { provider: 'scripted', model: 'missing', message: 'hi' }),
    );
    expect(error).toMatchObject({ code: 'MODEL_UNAVAILABLE', statusCode: 400 });
    expect((await ctx.quota.summary({ kind: 'user', id: 'user-1' })).used).toBe(0);
  });

  it('rejects a message that cannot fit the model, saving nothing and charging nothing', async () => {
    const ctx = setup({ contextWindow: 200 });
    const error = await appError(
      ctx.chat.prepare(USER, { provider: 'scripted', model: 'fast-1', message: 'x'.repeat(2_000) }),
    );
    expect(error.code).toBe('CONTEXT_TOO_LARGE');
    expect(ctx.conversations.data.messages).toHaveLength(0);
    expect((await ctx.quota.summary({ kind: 'user', id: 'user-1' })).used).toBe(0);
  });
});

describe('cost estimates', () => {
  it('saves an estimated cost from registry prices and provider usage', async () => {
    const ctx = setup();
    const [row] = await ctx.models.catalog();
    await ctx.models.update(row!.registryId, {
      inputPricePerMillionUsd: 0.5,
      outputPricePerMillionUsd: 2,
    });

    await run(ctx, USER, { message: 'priced question' });
    // 20 input tokens × $0.50/M + 5 output tokens × $2/M
    expect(ctx.conversations.data.runs[0]).toMatchObject({ estimatedCostUsd: 0.00002 });
  });

  it('records no cost when prices are unknown', async () => {
    const ctx = setup();
    await run(ctx, USER, { message: 'unpriced question' });
    expect(ctx.conversations.data.runs[0]).toMatchObject({ estimatedCostUsd: null });
  });

  it('refuses a model an admin disabled', async () => {
    const ctx = setup();
    const [row] = await ctx.models.catalog();
    await ctx.models.update(row!.registryId, { enabled: false });
    const error = await appError(
      ctx.chat.prepare(USER, { provider: 'scripted', model: 'fast-1', message: 'hi' }),
    );
    expect(error.code).toBe('MODEL_UNAVAILABLE');
  });
});

describe('failures and cancellation', () => {
  it('records a failure with no output, refunds the allowance, and allows a retry', async () => {
    const ctx = setup();
    const busy: ScriptStep = {
      type: 'throw',
      error: new AIProviderError({
        provider: 'scripted',
        code: 'RATE_LIMITED',
        message: 'Scripted is busy',
      }),
    };
    // The first request retries once (ADR-013) and has no other model to fall back to.
    ctx.provider.setScripts([busy], [busy], [say('Recovered'), done]);

    const failed = await run(ctx, USER, { message: 'hello?' });
    expect(failed.at(-1)).toEqual({
      event: 'error',
      data: {
        runId: failed[0]?.data.runId,
        code: 'RATE_LIMITED',
        message: 'Scripted is busy',
        retryable: true,
      },
    });
    expect(ctx.conversations.data.runs[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'RATE_LIMITED',
      messageId: null,
    });
    expect((await ctx.quota.summary({ kind: 'user', id: 'user-1' })).used).toBe(0);

    const conversationId = ctx.conversations.data.conversations[0]!.id;
    const retried = await run(ctx, USER, { retry: true, conversationId });
    expect(retried.at(-1)).toMatchObject({ event: 'message.done', data: { status: 'completed' } });
    const messages = await ctx.conversations.listMessages(conversationId);
    expect(messages.map((message) => message.content)).toEqual(['hello?', 'Recovered']);
  });

  it('only allows retry when the last message is unanswered', async () => {
    const ctx = setup();
    await run(ctx, USER, { message: 'answered' });
    const conversationId = ctx.conversations.data.conversations[0]!.id;
    const error = await appError(
      ctx.chat.prepare(USER, {
        provider: 'scripted',
        model: 'fast-1',
        retry: true,
        conversationId,
      }),
    );
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('records a timeout as TIMEOUT', async () => {
    const ctx = setup();
    ctx.provider.setScripts([
      {
        type: 'throw',
        error: new AIProviderError({
          provider: 'scripted',
          code: 'PROVIDER_TIMEOUT',
          message: 'slow',
        }),
      },
    ]);
    await run(ctx, USER, { message: 'hi' });
    expect(ctx.conversations.data.runs[0]?.status).toBe('TIMEOUT');
  });

  it('keeps the allowance but saves no partial answer when a stream fails midway', async () => {
    const ctx = setup();
    ctx.provider.setScripts([
      say('Half an answ'),
      {
        type: 'throw',
        error: new AIProviderError({
          provider: 'scripted',
          code: 'MODEL_UNAVAILABLE',
          message: 'dropped',
        }),
      },
    ]);
    await run(ctx, USER, { message: 'hi' });
    expect(ctx.conversations.data.messages.map((message) => message.role)).toEqual(['USER']);
    expect((await ctx.quota.summary({ kind: 'user', id: 'user-1' })).used).toBe(1);
  });

  it('saves the partial answer when the user stops the stream', async () => {
    const ctx = setup();
    ctx.provider.setScripts([say('Partial'), { type: 'hang' }]);
    const events = await run(
      ctx,
      USER,
      { message: 'long question' },
      { abortAfterFirstDelta: true },
    );

    expect(events.at(-1)).toMatchObject({ event: 'message.done', data: { status: 'cancelled' } });
    expect(ctx.conversations.data.runs[0]).toMatchObject({ status: 'CANCELLED' });
    expect(ctx.conversations.data.messages.at(-1)).toMatchObject({
      role: 'ASSISTANT',
      content: 'Partial',
    });
  });

  it('hides unexpected errors behind a generic retryable message and logs them', async () => {
    const ctx = setup();
    ctx.provider.setScripts([{ type: 'throw', error: new Error('socket hang up at 10.0.0.3') }]);
    const events = await run(ctx, USER, { message: 'hi' });
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'INTERNAL_ERROR', retryable: true },
    });
    expect(JSON.stringify(events)).not.toContain('10.0.0.3');
    expect(ctx.logger.error).toHaveBeenCalled();
  });
});

describe('guests', () => {
  it('keeps the chat in Redis and never creates database rows', async () => {
    const ctx = setup();
    const guest = await ctx.guests.create();
    const events = await run(
      ctx,
      { kind: 'guest', guest, ipHash: 'ip-1' },
      { message: 'hi as guest' },
    );

    expect(events[0]).toMatchObject({ data: { conversationId: null } });
    expect(events.at(-1)).toMatchObject({ data: { status: 'completed', messageId: null } });
    expect(ctx.conversations.data.conversations).toHaveLength(0);

    const stored = await ctx.guestChats.get(guest.id);
    expect(stored.map((message) => [message.role, message.content])).toEqual([
      ['user', 'hi as guest'],
      ['assistant', 'Hello there'],
    ]);
    expect(stored[1]?.run).toMatchObject({
      provider: 'scripted',
      model: 'fast-1',
      status: 'completed',
    });
  });

  it('migrates the guest chat into an account once, then clears it', async () => {
    const ctx = setup();
    const guest = await ctx.guests.create();
    await run(ctx, { kind: 'guest', guest, ipHash: 'ip-1' }, { message: 'remember this' });

    const first = await ctx.chat.migrateGuest('user-9', guest);
    expect(first).toEqual(expect.any(String));
    expect(await ctx.guestChats.get(guest.id)).toEqual([]);

    const messages = await ctx.conversations.listMessages(first!);
    expect(messages.map((message) => message.content)).toEqual(['remember this', 'Hello there']);
    expect(messages[1]?.run).toMatchObject({ provider: 'scripted', status: 'COMPLETED' });

    expect(await ctx.chat.migrateGuest('user-9', guest)).toBeNull();
    expect(ctx.conversations.data.conversations).toHaveLength(1);
  });
});
