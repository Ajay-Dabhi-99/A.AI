import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/plugins/prisma.js';
import {
  createPrismaConversationRepository,
  type ConversationRepository,
} from '../../src/repositories/conversation.repository.js';
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
