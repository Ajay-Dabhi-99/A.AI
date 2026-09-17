import { describe, expect, it } from 'vitest';
import type { RunStatusValue } from '../../src/repositories/conversation.repository.js';
import {
  decodeCursor,
  encodeCursor,
  HistoryService,
  oneLine,
  P95_MIN_COMPLETED_RUNS,
} from '../../src/modules/history/history.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { silentLogger, TestClock } from '../helpers/fakes.js';
import { createMemoryComparisons } from '../helpers/memory-comparisons.js';
import { createMemoryConversations } from '../helpers/memory-conversations.js';
import { createMemoryHistory } from '../helpers/memory-history.js';

const ME = 'user-1';
const SOMEONE_ELSE = 'user-2';
const defaults = { type: 'all' as const, limit: 20 };

function setup() {
  const conversations = createMemoryConversations();
  const comparisons = createMemoryComparisons();
  const clock = new TestClock('2026-09-15T12:00:00.000Z');
  const service = new HistoryService({
    history: createMemoryHistory(conversations, comparisons),
    conversations,
    attachments: {
      keysForConversation: async () => [],
      removeObjects: async () => undefined,
      generatedIdsForConversation: async () => [],
      removeRows: async () => undefined,
    },
    clock,
    logger: silentLogger(),
  });
  return { conversations, comparisons, clock, service };
}

type Context = ReturnType<typeof setup>;

type RunSpec = {
  provider?: string;
  model?: string;
  status?: Exclude<RunStatusValue, 'RUNNING'>;
  cost?: number | null;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  usageSource?: 'provider' | 'estimated';
  fallback?: boolean;
  at?: string;
};

async function chat(ctx: Context, userId: string, title: string, runs: RunSpec[] = [{}]) {
  const conversation = await ctx.conversations.create({ userId, title });
  for (const spec of runs) {
    const run = await ctx.conversations.startRun({
      conversationId: conversation.id,
      provider: spec.provider ?? 'groq',
      model: spec.model ?? 'gpt-oss-20b',
    });
    await ctx.conversations.completeRun(run.id, {
      conversationId: conversation.id,
      status: spec.status ?? 'COMPLETED',
      messageContent: (spec.status ?? 'COMPLETED') === 'COMPLETED' ? 'answer' : null,
      ttftMs: 100,
      latencyMs: spec.latencyMs ?? 1_000,
      inputTokens: spec.inputTokens ?? 10,
      outputTokens: spec.outputTokens ?? 5,
      usageSource: spec.usageSource ?? 'provider',
      errorCode: (spec.status ?? 'COMPLETED') === 'COMPLETED' ? null : 'PROVIDER_TIMEOUT',
      estimatedCostUsd: spec.cost === undefined ? null : spec.cost,
      ...(spec.fallback
        ? {
            attemptCount: 3,
            fallback: {
              provider: spec.provider ?? 'groq',
              model: spec.model ?? 'gpt-oss-20b',
              requestedProvider: 'gemini',
              requestedModel: 'gemini-flash',
              reason: 'RATE_LIMITED',
            },
          }
        : {}),
      completedAt: new Date(),
    });
    if (spec.at) {
      const stored = ctx.conversations.data.runs.find((candidate) => candidate.id === run.id);
      if (stored) stored.createdAt = new Date(spec.at);
    }
  }
  return conversation.id;
}

async function compare(ctx: Context, userId: string, prompt: string, providers: string[]) {
  const { comparison, runs } = await ctx.comparisons.create({
    userId,
    prompt,
    runs: providers.map((provider) => ({ provider, model: `${provider}-model` })),
  });
  for (const run of runs) {
    await ctx.comparisons.completeRun(run.id, {
      status: 'COMPLETED',
      content: 'answer',
      ttftMs: 50,
      latencyMs: 700,
      inputTokens: 20,
      outputTokens: 10,
      usageSource: 'estimated',
      errorCode: null,
      estimatedCostUsd: 0.001,
      completedAt: new Date(),
    });
  }
  return comparison.id;
}

describe('history list', () => {
  it('lists chats and comparisons newest first with counts, models and cost', async () => {
    const ctx = setup();
    const chatId = await chat(ctx, ME, 'Trip plans', [
      { provider: 'groq', cost: 0.002 },
      { provider: 'gemini', model: 'flash', status: 'FAILED' },
      { provider: 'groq', cost: 0.001 },
    ]);
    const comparisonId = await compare(ctx, ME, 'Compare\n   these   models', ['alpha', 'beta']);
    // Make the chat the most recently active item.
    ctx.conversations.data.conversations[0]!.updatedAt = new Date('2026-09-20T00:00:00.000Z');

    const { items, nextCursor } = await ctx.service.list(ME, defaults);

    expect(items.map((item) => [item.kind, item.id])).toEqual([
      ['conversation', chatId],
      ['comparison', comparisonId],
    ]);
    expect(items[0]).toMatchObject({
      title: 'Trip plans',
      runCount: 3,
      failedRunCount: 1,
      models: [
        { provider: 'groq', model: 'gpt-oss-20b' },
        { provider: 'gemini', model: 'flash' },
      ],
      estimatedCostUsd: 0.003,
    });
    expect(items[1]).toMatchObject({
      title: 'Compare these models',
      runCount: 2,
      estimatedCostUsd: 0.002,
    });
    expect(nextCursor).toBeNull();
  });

  it('reports no cost rather than zero when no run has an estimate', async () => {
    const ctx = setup();
    await chat(ctx, ME, 'Unpriced', [{ cost: null }]);
    const [item] = (await ctx.service.list(ME, defaults)).items;
    expect(item?.estimatedCostUsd).toBeNull();
  });

  it('searches titles and prompts case-insensitively, with wildcards taken literally', async () => {
    const ctx = setup();
    await chat(ctx, ME, 'Budget is 50% of revenue');
    await chat(ctx, ME, 'Budget is 5000 dollars');
    await compare(ctx, ME, 'Which BUDGET tool?', ['alpha']);

    const titles = async (q: string) =>
      (await ctx.service.list(ME, { ...defaults, q })).items.map((item) => item.title);

    expect(await titles('budget')).toHaveLength(3);
    expect(await titles('50%')).toEqual(['Budget is 50% of revenue']);
    expect(await titles('5_00')).toEqual([]);
  });

  it('filters by kind, model and date range', async () => {
    const ctx = setup();
    await chat(ctx, ME, 'Groq chat', [{ provider: 'groq', model: 'gpt-oss-20b' }]);
    await chat(ctx, ME, 'Gemini chat', [{ provider: 'gemini', model: 'flash' }]);
    await compare(ctx, ME, 'A comparison', ['alpha']);

    expect((await ctx.service.list(ME, { ...defaults, type: 'comparison' })).items).toHaveLength(1);
    expect(
      (await ctx.service.list(ME, { ...defaults, provider: 'gemini', model: 'flash' })).items.map(
        (item) => item.title,
      ),
    ).toEqual(['Gemini chat']);
    // Memory timestamps are on 2026-09-13 and 2026-09-15.
    expect((await ctx.service.list(ME, { ...defaults, from: '2026-10-01' })).items).toHaveLength(0);
  });

  it('pages with a keyset cursor, never repeating or skipping an item', async () => {
    const ctx = setup();
    for (let index = 0; index < 5; index++) await chat(ctx, ME, `Chat ${index}`);

    const first = await ctx.service.list(ME, { ...defaults, limit: 2 });
    const second = await ctx.service.list(ME, {
      ...defaults,
      limit: 2,
      cursor: first.nextCursor as string,
    });
    const third = await ctx.service.list(ME, {
      ...defaults,
      limit: 2,
      cursor: second.nextCursor as string,
    });

    const seen = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it('rejects a cursor it did not issue', async () => {
    const ctx = setup();
    await expect(
      ctx.service.list(ME, { ...defaults, cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const roundTrip = decodeCursor(
      encodeCursor({
        lastActivityAt: new Date('2026-09-15T00:00:00.000Z'),
        id: crypto.randomUUID(),
      }),
    );
    expect(roundTrip.lastActivityAt.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it("never shows or touches another user's items", async () => {
    const ctx = setup();
    const theirChat = await chat(ctx, SOMEONE_ELSE, 'Private');
    const theirComparison = await compare(ctx, SOMEONE_ELSE, 'Private prompt', ['alpha']);

    expect((await ctx.service.list(ME, defaults)).items).toEqual([]);
    for (const attempt of [
      ctx.service.conversationRuns(ME, theirChat),
      ctx.service.comparison(ME, theirComparison),
      ctx.service.updateConversation(ME, theirChat, { title: 'Mine now' }),
      ctx.service.updateConversation(ME, theirChat, { pinned: true }),
      ctx.service.delete(ME, 'conversation', theirChat),
      ctx.service.delete(ME, 'comparison', theirComparison),
    ]) {
      await expect(attempt).rejects.toBeInstanceOf(AppError);
    }
    expect(ctx.conversations.data.conversations[0]?.title).toBe('Private');
    expect(ctx.comparisons.data.comparisons).toHaveLength(1);
  });
});

describe('run detail, rename and delete', () => {
  it('shows every run of a chat, including failures and fallbacks', async () => {
    const ctx = setup();
    const id = await chat(ctx, ME, 'Detail', [
      { status: 'FAILED' },
      { provider: 'groq', fallback: true, cost: 0.004 },
    ]);

    const { conversation, runs } = await ctx.service.conversationRuns(ME, id);

    expect(conversation.title).toBe('Detail');
    expect(runs.map((run) => run.status)).toEqual(['failed', 'completed']);
    expect(runs[0]).toMatchObject({ messageId: null, errorCode: 'PROVIDER_TIMEOUT' });
    expect(runs[1]).toMatchObject({
      requested: { provider: 'gemini', model: 'gemini-flash' },
      attemptCount: 3,
      fallbackReason: 'RATE_LIMITED',
      estimatedCostUsd: 0.004,
      usageSource: 'provider',
    });
  });

  it('reopens a saved comparison with its answers in order', async () => {
    const ctx = setup();
    const id = await compare(ctx, ME, 'Which is faster?', ['alpha', 'beta']);
    const detail = await ctx.service.comparison(ME, id);
    expect(detail.prompt).toBe('Which is faster?');
    expect(detail.runs.map((run) => [run.position, run.provider, run.content])).toEqual([
      [0, 'alpha', 'answer'],
      [1, 'beta', 'answer'],
    ]);
    expect(detail.runs[0]).toMatchObject({ requested: null, attemptCount: 1 });
  });

  it('renames without changing the activity time', async () => {
    const ctx = setup();
    const id = await chat(ctx, ME, 'Old title');
    const before = ctx.conversations.data.conversations[0]!.updatedAt.toISOString();

    const { conversation } = await ctx.service.updateConversation(ME, id, { title: 'New title' });

    expect(conversation).toMatchObject({ title: 'New title', updatedAt: before, pinnedAt: null });
  });

  it('pins and unpins at the clock time, keeping the title and activity time', async () => {
    const ctx = setup();
    const id = await chat(ctx, ME, 'Keep me');
    const before = ctx.conversations.data.conversations[0]!.updatedAt.toISOString();

    const pinned = await ctx.service.updateConversation(ME, id, { pinned: true });
    expect(pinned.conversation).toMatchObject({
      title: 'Keep me',
      pinnedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: before,
    });

    ctx.clock.advance(60_000);
    const both = await ctx.service.updateConversation(ME, id, { title: 'Renamed', pinned: true });
    expect(both.conversation).toMatchObject({
      title: 'Renamed',
      pinnedAt: '2026-09-15T12:01:00.000Z',
    });

    const unpinned = await ctx.service.updateConversation(ME, id, { pinned: false });
    expect(unpinned.conversation).toMatchObject({ title: 'Renamed', pinnedAt: null });
  });

  it('deletes a chat with its runs, which also leave the usage report', async () => {
    const ctx = setup();
    const id = await chat(ctx, ME, 'Delete me', [{}, {}]);
    expect((await ctx.service.usage({ kind: 'personal', userId: ME }, 30)).totals.runs).toBe(2);

    await ctx.service.delete(ME, 'conversation', id);

    expect(ctx.conversations.data.runs).toHaveLength(0);
    expect(ctx.conversations.data.messages).toHaveLength(0);
    expect((await ctx.service.usage({ kind: 'personal', userId: ME }, 30)).totals.runs).toBe(0);
    await expect(ctx.service.conversationRuns(ME, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('usage report', () => {
  it('totals chat and comparison runs honestly', async () => {
    const ctx = setup();
    await chat(ctx, ME, 'Mixed', [
      { cost: 0.01, latencyMs: 1_000, inputTokens: 100, outputTokens: 50 },
      { status: 'FAILED', cost: null, usageSource: 'estimated' },
      { status: 'CANCELLED', cost: null },
      { fallback: true, cost: 0.02, latencyMs: 3_000 },
    ]);
    await compare(ctx, ME, 'Compare', ['alpha']);
    await chat(ctx, SOMEONE_ELSE, 'Not mine', [{ cost: 5 }]);

    const report = await ctx.service.usage({ kind: 'personal', userId: ME }, 30);

    expect(report.scope).toBe('personal');
    expect(report.activeUsers).toBeNull();
    expect(report.totals).toMatchObject({
      runs: 5,
      completedRuns: 3,
      failedRuns: 1,
      cancelledRuns: 1,
      inputTokens: 100 + 10 + 10 + 10 + 20,
      providerCountedRuns: 3,
      estimatedCostUsd: 0.031,
      costedRuns: 3,
      averageLatencyMs: Math.round((1_000 + 3_000 + 700) / 3),
      p95LatencyMs: null,
      fallbackRuns: 1,
    });
    expect(report.byModel.map((row) => [row.provider, row.runs])).toEqual([
      ['groq', 4],
      ['alpha', 1],
    ]);
  });

  it('returns every day in the range, including empty ones, and excludes older runs', async () => {
    const ctx = setup();
    await chat(ctx, ME, 'Dated', [
      { at: '2026-09-14T08:00:00.000Z' },
      { at: '2026-09-15T08:00:00.000Z' },
      { at: '2026-09-01T08:00:00.000Z' },
    ]);

    const report = await ctx.service.usage({ kind: 'personal', userId: ME }, 7);

    expect(report.range).toEqual({ from: '2026-09-09', to: '2026-09-15', days: 7 });
    expect(report.byDay.map((day) => day.day)).toEqual([
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
    ]);
    expect(report.byDay.map((day) => day.runs)).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(report.totals.runs).toBe(2);
  });

  it(`reports a p95 only from ${P95_MIN_COMPLETED_RUNS} completed runs`, async () => {
    const ctx = setup();
    const latencies = Array.from({ length: P95_MIN_COMPLETED_RUNS }, (_, index) => ({
      latencyMs: (index + 1) * 100,
    }));
    await chat(ctx, ME, 'Many', latencies);

    const report = await ctx.service.usage({ kind: 'personal', userId: ME }, 30);
    // percentile_cont(0.95) over 100..2000: rank 18.05 -> 1900 + 0.05 * 100.
    expect(report.totals.p95LatencyMs).toBe(1_905);
  });

  it('gives admins deployment totals with the number of active users, never per-user rows', async () => {
    const ctx = setup();
    await chat(ctx, ME, 'One', [{}]);
    await chat(ctx, SOMEONE_ELSE, 'Two', [{}, {}]);

    const report = await ctx.service.usage({ kind: 'deployment' }, 30);

    expect(report).toMatchObject({ scope: 'deployment', activeUsers: 2 });
    expect(report.totals.runs).toBe(3);
    expect(JSON.stringify(report)).not.toContain(ME);
  });
});

describe('oneLine', () => {
  it('collapses whitespace and shortens long prompts', () => {
    expect(oneLine('  a\n\n b  ')).toBe('a b');
    expect(oneLine('x'.repeat(200))).toHaveLength(120);
    expect(oneLine('   ')).toBe('Untitled');
  });
});
