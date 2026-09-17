import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/plugins/prisma.js';
import {
  createPrismaConversationRepository,
  type ConversationRepository,
} from '../../src/repositories/conversation.repository.js';
import { createPrismaShareRepository } from '../../src/repositories/share.repository.js';
import { createPrismaRepositories } from '../../src/repositories/prisma.repositories.js';
import { testEnv } from '../helpers/test-app.js';

/** Phase 2 data gate against real Supabase PostgreSQL. */
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Live chat repository tests need TEST_DATABASE_URL (Supabase test project).');
}

let prisma: PrismaClient;
let conversations: ConversationRepository;
const userIds: string[] = [];

async function newUser(): Promise<string> {
  const user = await createPrismaRepositories(prisma).users.create({
    email: `live-chat-${randomUUID()}@example.test`,
    passwordHash: 'hash',
  });
  userIds.push(user.id);
  return user.id;
}

beforeAll(() => {
  prisma = createPrismaClient(testEnv({ DATABASE_URL: databaseUrl }));
  conversations = createPrismaConversationRepository(prisma);
});

afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});

describe('chat migration', () => {
  it('created the chat tables with Row Level Security enabled', async () => {
    const rows = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('conversations', 'messages', 'model_runs') AND relkind = 'r'
      ORDER BY relname`;
    expect(rows).toEqual([
      { relname: 'conversations', relrowsecurity: true },
      { relname: 'messages', relrowsecurity: true },
      { relname: 'model_runs', relrowsecurity: true },
    ]);
  });
});

describe('Prisma conversation repository', () => {
  it('stores a full turn and returns messages oldest first with their run', async () => {
    const userId = await newUser();
    const conversation = await conversations.create({ userId, title: 'Live test' });
    await conversations.addUserMessage(conversation.id, 'question');
    const run = await conversations.startRun({
      conversationId: conversation.id,
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
    });

    const { message } = await conversations.completeRun(run.id, {
      conversationId: conversation.id,
      status: 'COMPLETED',
      messageContent: 'answer',
      ttftMs: 120,
      latencyMs: 900,
      inputTokens: 12,
      outputTokens: 3,
      usageSource: 'provider',
      errorCode: null,
      estimatedCostUsd: 0.000012,
      completedAt: new Date(),
    });

    const messages = await conversations.listMessages(conversation.id);
    expect(messages.map((item) => [item.role, item.content])).toEqual([
      ['USER', 'question'],
      ['ASSISTANT', 'answer'],
    ]);
    expect(messages[1]?.id).toBe(message?.id);
    expect(messages[1]?.run).toMatchObject({
      status: 'COMPLETED',
      latencyMs: 900,
      outputTokens: 3,
    });
    expect(await conversations.findForUser(conversation.id, randomUUID())).toBeNull();
  });

  it('rewinds to a question, replacing its text and unlinking later answers', async () => {
    const userId = await newUser();
    const conversation = await conversations.create({ userId, title: 'Rewind' });
    const question = await conversations.addUserMessage(conversation.id, 'first question');
    const run = await conversations.startRun({
      conversationId: conversation.id,
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
    });
    const { message } = await conversations.completeRun(run.id, {
      conversationId: conversation.id,
      status: 'COMPLETED',
      messageContent: 'first answer',
      ttftMs: null,
      latencyMs: 500,
      inputTokens: null,
      outputTokens: null,
      usageSource: null,
      errorCode: null,
      estimatedCostUsd: null,
      completedAt: new Date(),
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { summary: 'old', summaryUpToMessageId: message!.id },
    });

    const removed = await conversations.rewindTo(conversation.id, question.id, 'edited question');

    expect(removed).toEqual([message!.id]);
    const messages = await conversations.listMessages(conversation.id);
    expect(messages.map((item) => [item.role, item.content])).toEqual([
      ['USER', 'edited question'],
    ]);
    expect(await prisma.modelRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      messageId: null,
    });
    expect(await conversations.findForUser(conversation.id, userId)).toMatchObject({
      summary: null,
      summaryUpToMessageId: null,
    });
    // Nothing after the question: a no-op apart from the text.
    expect(await conversations.rewindTo(conversation.id, question.id)).toEqual([]);
  });

  it('keeps a share per chat, with RLS, and removes it with the chat', async () => {
    const [rls] = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'conversation_shares' AND relkind = 'r'`;
    expect(rls?.relrowsecurity).toBe(true);

    const shares = createPrismaShareRepository(prisma);
    const userId = await newUser();
    const conversation = await conversations.create({ userId, title: 'Shared' });
    const at = new Date('2026-09-17T10:00:00.000Z');
    const messages = [{ role: 'user' as const, content: 'Hi', model: null }];
    const first = await shares.save(
      { conversationId: conversation.id, userId, title: 'Shared', messages },
      'a'.repeat(43),
      at,
    );
    const again = await shares.save(
      {
        conversationId: conversation.id,
        userId,
        title: 'Renamed',
        messages: [...messages, { role: 'assistant', content: 'Hello', model: 'M' }],
      },
      'b'.repeat(43),
      new Date('2026-09-17T11:00:00.000Z'),
    );
    expect(again).toMatchObject({ id: first.id, token: 'a'.repeat(43), title: 'Renamed' });
    expect(again.messages).toHaveLength(2);
    expect((await shares.findByToken('a'.repeat(43)))?.conversationId).toBe(conversation.id);

    await prisma.conversation.delete({ where: { id: conversation.id } });
    expect(await shares.findByToken('a'.repeat(43))).toBeNull();
  });

  it('imports a guest chat idempotently, even when two imports race', async () => {
    const userId = await newUser();
    const payload = {
      userId,
      title: 'Guest chat',
      guestMigrationKey: randomUUID().replaceAll('-', ''),
      messages: [
        { role: 'USER' as const, content: 'hi', createdAt: new Date(Date.now() - 2_000) },
        {
          role: 'ASSISTANT' as const,
          content: 'hello',
          createdAt: new Date(Date.now() - 1_000),
          run: {
            provider: 'groq',
            model: 'openai/gpt-oss-20b',
            status: 'COMPLETED' as const,
            latencyMs: 500,
          },
        },
      ],
    };

    const [first, second] = await Promise.all([
      conversations.importGuestConversation(payload),
      conversations.importGuestConversation(payload),
    ]);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(first.conversation.id).toBe(second.conversation.id);
    expect(await conversations.listMessages(first.conversation.id)).toHaveLength(2);
  });
});
