import type { ChatStreamEvent } from '@a-ai/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { SUMMARY_HEADING } from '../../src/ai/context-builder.js';
import type { ConversationSummarizer, SummaryInput } from '../../src/ai/summarizer.js';
import { TokenService } from '../../src/ai/token.service.js';
import { ChatService, type ChatCaller } from '../../src/modules/chat/chat.service.js';
import { GuestConversationStore } from '../../src/modules/chat/guest-conversation.store.js';
import { GuestService } from '../../src/modules/guest/guest.service.js';
import { createAdapterRegistry, registryDefaults } from '../../src/providers/model-directory.js';
import { ModelRegistryService } from '../../src/providers/model-registry.service.js';
import { ContextService } from '../../src/services/context.service.js';
import { createRedisStore } from '../../src/services/kv-store.js';
import { QuotaService } from '../../src/services/quota.service.js';
import { silentLogger, TestClock } from '../helpers/fakes.js';
import { createMemoryConversations } from '../helpers/memory-conversations.js';
import { createMemoryModelRegistry } from '../helpers/memory-model-registry.js';
import { ScriptedProvider, testModel, type ScriptStep } from '../helpers/scripted-provider.js';
import { controlledRedis } from '../helpers/test-app.js';

const USER: ChatCaller = { kind: 'user', userId: 'user-1' };
const answer: ScriptStep[] = [
  { type: 'delta', text: 'Answer' },
  { type: 'done', finishReason: 'stop' },
];
/** A 400-character message (104 estimated tokens) that is easy to find in a request. */
const question = (n: number) => `question ${n} `.padEnd(400, '.');

/**
 * A model whose budget is 470 tokens (600 × 0.95 − 100), so the fourth
 * question no longer fits beside the first one.
 */
const SMALL_MODEL = { contextWindow: 600, maxOutputTokens: 100 };

function setup(options: { summariesEnabled?: boolean; summarizer?: ConversationSummarizer } = {}) {
  const store = createRedisStore(controlledRedis());
  const clock = new TestClock();
  const logger = silentLogger();
  const conversations = createMemoryConversations();
  const provider = new ScriptedProvider('scripted', answer);
  const model = testModel('scripted', 'small-1', SMALL_MODEL);
  const entries = [{ provider, models: [model] }];
  const models = new ModelRegistryService({
    repository: createMemoryModelRegistry(),
    adapters: createAdapterRegistry(entries),
    defaults: registryDefaults([model]),
    providerNames: {},
    clock,
    logger,
  });
  const summarize = vi.fn(async (input: SummaryInput) => `summary of ${input.messages.length}`);
  const tokens = new TokenService(store);
  const context = new ContextService({
    store,
    conversations,
    tokens,
    summarizer: options.summarizer ?? { summarize },
    summariesEnabled: options.summariesEnabled ?? true,
    clock,
    logger,
  });
  const guestChats = new GuestConversationStore(store, clock);
  const chat = new ChatService({
    models,
    conversations,
    guestChats,
    context,
    quota: new QuotaService(store, { guest: 50, user: 50 }, clock),
    clock,
    logger,
  });
  return {
    store,
    logger,
    conversations,
    provider,
    model,
    summarize,
    tokens,
    context,
    chat,
    guestChats,
    guests: new GuestService(store, 60, clock),
  };
}

type Context = ReturnType<typeof setup>;

async function send(
  ctx: Context,
  caller: ChatCaller,
  message: string,
  conversationId?: string,
): Promise<ChatStreamEvent[]> {
  const prepared = await ctx.chat.prepare(caller, {
    provider: 'scripted',
    model: 'small-1',
    message,
    ...(conversationId ? { conversationId } : {}),
  });
  const events: ChatStreamEvent[] = [];
  await prepared.execute(new AbortController().signal, (event) => events.push(event));
  await ctx.context.idle();
  return events;
}

/** Sends `count` questions as one conversation and returns its id. */
async function conversationWith(ctx: Context, count: number): Promise<string> {
  await send(ctx, USER, question(1));
  const conversationId = ctx.conversations.data.conversations[0]!.id;
  for (let n = 2; n <= count; n++) await send(ctx, USER, question(n), conversationId);
  return conversationId;
}

function startOf(events: ChatStreamEvent[]) {
  const start = events[0];
  if (start?.event !== 'message.start') throw new Error('expected message.start first');
  return start.data;
}

describe('summaries for saved conversations', () => {
  it('reports how the context was built on message.start', async () => {
    const ctx = setup();
    const events = await send(ctx, USER, question(1));
    expect(startOf(events).context).toEqual({
      inputTokens: expect.any(Number),
      budgetTokens: 470,
      contextWindow: 600,
      droppedMessages: 0,
      summaryIncluded: false,
    });
    expect(startOf(events).context.inputTokens).toBeLessThanOrEqual(470);
  });

  it('folds messages that stopped fitting into a summary, then sends the summary instead', async () => {
    const ctx = setup();
    const conversationId = await conversationWith(ctx, 3);
    expect(ctx.summarize).not.toHaveBeenCalled();

    // The fourth question leaves out question 1 and its answer.
    const fourth = await send(ctx, USER, question(4), conversationId);
    expect(startOf(fourth).context).toMatchObject({ droppedMessages: 2, summaryIncluded: false });
    expect(ctx.summarize).toHaveBeenCalledTimes(1);
    const folded = ctx.summarize.mock.calls[0]![0];
    expect(folded.previousSummary).toBeNull();
    expect(folded.messages.map((message) => message.content)).toEqual([question(1), 'Answer']);
    expect(folded.model.id).toBe('small-1');

    const [firstQuestion, firstAnswer] = await ctx.conversations.listMessages(conversationId);
    expect(ctx.conversations.data.conversations[0]).toMatchObject({
      summary: 'summary of 2',
      summaryUpToMessageId: firstAnswer!.id,
    });

    const fifth = await send(ctx, USER, question(5), conversationId);
    expect(startOf(fifth).context).toMatchObject({ summaryIncluded: true });
    const sent = ctx.provider.requests.at(-1)!.messages;
    expect(sent[0]?.content).toContain(`${SUMMARY_HEADING}\nsummary of 2`);
    expect(sent.some((message) => message.content === firstQuestion!.content)).toBe(false);
    expect(startOf(fifth).context.inputTokens).toBeLessThanOrEqual(470);
  });

  it('extends the previous summary rather than starting over', async () => {
    const ctx = setup();
    const conversationId = await conversationWith(ctx, 7);

    const calls = ctx.summarize.mock.calls.map(([input]) => input);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.at(-1)?.previousSummary).toMatch(/^summary of/);
    const stored = ctx.conversations.data.conversations.find((c) => c.id === conversationId);
    const messages = await ctx.conversations.listMessages(conversationId);
    const coveredIndex = messages.findIndex(
      (message) => message.id === stored?.summaryUpToMessageId,
    );
    expect(coveredIndex).toBeGreaterThan(1);
  });

  it('keeps trimming and logs when summarizing fails', async () => {
    const summarizer = { summarize: vi.fn(async () => Promise.reject(new Error('provider down'))) };
    const ctx = setup({ summarizer });
    const conversationId = await conversationWith(ctx, 5);

    expect(summarizer.summarize).toHaveBeenCalled();
    expect(ctx.conversations.data.conversations[0]?.summary).toBeNull();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'context.summary', outcome: 'failed' }),
      expect.any(String),
    );
    const sixth = await send(ctx, USER, question(6), conversationId);
    expect(sixth.at(-1)).toMatchObject({ event: 'message.done', data: { status: 'completed' } });
    expect(startOf(sixth).context.inputTokens).toBeLessThanOrEqual(470);
  });

  it('makes no summary calls when summaries are turned off', async () => {
    const ctx = setup({ summariesEnabled: false });
    const conversationId = await conversationWith(ctx, 6);
    expect(ctx.summarize).not.toHaveBeenCalled();
    const last = await send(ctx, USER, question(7), conversationId);
    expect(startOf(last).context.droppedMessages).toBeGreaterThan(0);
  });

  it('does not start a second summary while one holds the lock', async () => {
    const ctx = setup();
    const conversationId = await conversationWith(ctx, 3);
    await ctx.store.setJsonIfAbsent(`context:${conversationId}:summary-lock`, {}, 60_000);

    await send(ctx, USER, question(4), conversationId);
    expect(ctx.summarize).not.toHaveBeenCalled();

    await ctx.store.delete(`context:${conversationId}:summary-lock`);
    await send(ctx, USER, question(5), conversationId);
    expect(ctx.summarize).toHaveBeenCalledTimes(1);
  });

  it('never replaces a newer summary with an older one', async () => {
    const ctx = setup();
    const conversationId = await conversationWith(ctx, 1);
    const [message] = await ctx.conversations.listMessages(conversationId);
    const update = { summary: 'new', upToMessageId: message!.id, updatedAt: new Date() };

    expect(
      await ctx.conversations.updateSummary(conversationId, {
        ...update,
        expectedUpToMessageId: null,
      }),
    ).toBe(true);
    expect(
      await ctx.conversations.updateSummary(conversationId, {
        ...update,
        summary: 'stale',
        expectedUpToMessageId: null,
      }),
    ).toBe(false);
    expect(ctx.conversations.data.conversations[0]?.summary).toBe('new');
  });
});

describe('guests and calibration', () => {
  it("keeps a guest's summary in Redis and clears it with the chat", async () => {
    const ctx = setup();
    const guest: ChatCaller = { kind: 'guest', guest: await ctx.guests.create(), ipHash: 'ip-1' };
    for (let n = 1; n <= 5; n++) await send(ctx, guest, question(n));

    expect(ctx.conversations.data.conversations).toHaveLength(0);
    const guestId = guest.kind === 'guest' ? guest.guest.id : '';
    expect(await ctx.context.guestSummary(guestId)).toMatchObject({ summary: expect.any(String) });

    const next = await send(ctx, guest, question(6));
    expect(startOf(next).context.summaryIncluded).toBe(true);

    await ctx.chat.clearGuest(guestId);
    expect(await ctx.context.guestSummary(guestId)).toBeNull();
    expect(await ctx.guestChats.get(guestId)).toEqual([]);
  });

  it('calibrates the model from provider token counts after completed answers', async () => {
    const ctx = setup();
    // Provider says every request is about 2 characters per token.
    ctx.provider.setScripts([
      { type: 'delta', text: 'Answer' },
      { type: 'usage', usage: { source: 'provider', inputTokens: 260, outputTokens: 2 } },
      { type: 'done', finishReason: 'stop' },
    ]);
    for (let n = 1; n <= 3; n++) await send(ctx, USER, question(n));

    const ratio = await ctx.tokens.charsPerToken(ctx.model);
    expect(ratio).toBeLessThan(4);
    expect(ratio).toBeGreaterThanOrEqual(2);
  });
});
