import { describe, expect, it } from 'vitest';
import { SHARE_MAX_MESSAGES, ShareService } from '../../src/modules/chat/share.service.js';
import { TestClock } from '../helpers/fakes.js';
import { createMemoryConversations } from '../helpers/memory-conversations.js';
import { createMemoryShares } from '../helpers/memory-shares.js';
import { testModel } from '../helpers/scripted-provider.js';

const ME = 'user-1';

function setup() {
  const conversations = createMemoryConversations();
  const shares = createMemoryShares();
  const clock = new TestClock('2026-09-17T10:00:00.000Z');
  const service = new ShareService({
    shares,
    conversations,
    models: {
      catalog: async () => [{ ...testModel('groq', 'g-1'), name: 'Groq One' }] as never,
    },
    clock,
  });
  return { conversations, shares, clock, service };
}

async function chatWith(ctx: ReturnType<typeof setup>, turns: [string, string][], userId = ME) {
  const conversation = await ctx.conversations.create({ userId, title: 'Trip ideas' });
  for (const [question, answer] of turns) {
    await ctx.conversations.addUserMessage(conversation.id, question);
    const run = await ctx.conversations.startRun({
      conversationId: conversation.id,
      provider: 'groq',
      model: 'g-1',
    });
    await ctx.conversations.completeRun(run.id, {
      conversationId: conversation.id,
      status: 'COMPLETED',
      messageContent: answer,
      ttftMs: null,
      latencyMs: 10,
      inputTokens: null,
      outputTokens: null,
      usageSource: null,
      errorCode: null,
      estimatedCostUsd: null,
      completedAt: ctx.clock.now(),
    });
  }
  return conversation.id;
}

describe('ShareService', () => {
  it('shares a text snapshot with model names, and later messages stay private until updated', async () => {
    const ctx = setup();
    const id = await chatWith(ctx, [['Where to go?', 'Jaipur.']]);

    const created = (await ctx.service.share(ME, id)).share!;
    expect(created).toMatchObject({ messageCount: 2, createdAt: '2026-09-17T10:00:00.000Z' });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await ctx.service.read(created.token)).toEqual({
      title: 'Trip ideas',
      messages: [
        { role: 'user', content: 'Where to go?', model: null },
        { role: 'assistant', content: 'Jaipur.', model: 'Groq One' },
      ],
      sharedAt: '2026-09-17T10:00:00.000Z',
      truncated: false,
    });

    await ctx.conversations.addUserMessage(id, 'My private follow-up');
    expect((await ctx.service.read(created.token)).messages).toHaveLength(2);

    ctx.clock.advance(60_000);
    const updated = (await ctx.service.share(ME, id)).share!;
    expect(updated.token).toBe(created.token);
    expect(updated).toMatchObject({ messageCount: 3, updatedAt: '2026-09-17T10:01:00.000Z' });
    expect((await ctx.service.read(created.token)).messages.at(-1)?.content).toBe(
      'My private follow-up',
    );
  });

  it('keeps only the newest messages of a very long chat', async () => {
    const ctx = setup();
    const turns = Array.from({ length: 110 }, (_, index): [string, string] => [
      `Q${index}`,
      `A${index}`,
    ]);
    const id = await chatWith(ctx, turns);
    const { share } = await ctx.service.share(ME, id);
    const read = await ctx.service.read(share!.token);
    expect(read.messages).toHaveLength(SHARE_MAX_MESSAGES);
    expect(read.messages.at(-1)?.content).toBe('A109');
    expect(read.truncated).toBe(true);
  });

  it("refuses empty, unknown and other users' chats, and unknown links", async () => {
    const ctx = setup();
    const empty = await ctx.conversations.create({ userId: ME, title: 'Empty' });
    await expect(ctx.service.share(ME, empty.id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const theirs = await chatWith(ctx, [['Secret?', 'Yes.']], 'user-2');
    for (const attempt of [
      ctx.service.share(ME, theirs),
      ctx.service.get(ME, theirs),
      ctx.service.stop(ME, theirs),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(ctx.service.read('x'.repeat(43))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stops sharing, after which the link no longer works', async () => {
    const ctx = setup();
    const id = await chatWith(ctx, [['Hi', 'Hello']]);
    expect(await ctx.service.get(ME, id)).toEqual({ share: null });
    const { share } = await ctx.service.share(ME, id);
    expect((await ctx.service.get(ME, id)).share?.token).toBe(share!.token);

    await ctx.service.stop(ME, id);
    expect(await ctx.service.get(ME, id)).toEqual({ share: null });
    await expect(ctx.service.read(share!.token)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(ctx.service.stop(ME, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
