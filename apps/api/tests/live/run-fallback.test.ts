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

/** Phase 6 data gate against real Supabase PostgreSQL. */
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Live fallback tests need TEST_DATABASE_URL (Supabase test project).');
}

let prisma: PrismaClient;
let conversations: ConversationRepository;
const userIds: string[] = [];

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

describe('model run fallback columns', () => {
  it('records the answering model, the requested one, attempts and the reason', async () => {
    const user = await createPrismaRepositories(prisma).users.create({
      email: `live-fallback-${randomUUID()}@example.test`,
      passwordHash: 'hash',
    });
    userIds.push(user.id);
    const conversation = await conversations.create({ userId: user.id, title: 'Fallback' });
    await conversations.addUserMessage(conversation.id, 'question');

    const plain = await conversations.startRun({
      conversationId: conversation.id,
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
    });
    expect(plain).toMatchObject({ attemptCount: 1, requestedProvider: null, fallbackReason: null });

    const { run, message } = await conversations.completeRun(plain.id, {
      conversationId: conversation.id,
      status: 'COMPLETED',
      messageContent: 'answer from gemini',
      ttftMs: 300,
      latencyMs: 2_100,
      inputTokens: 12,
      outputTokens: 4,
      usageSource: 'provider',
      errorCode: null,
      estimatedCostUsd: null,
      attemptCount: 3,
      fallback: {
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        requestedProvider: 'groq',
        requestedModel: 'openai/gpt-oss-20b',
        reason: 'RATE_LIMITED',
      },
      completedAt: new Date(),
    });

    expect(run).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      requestedProvider: 'groq',
      requestedModel: 'openai/gpt-oss-20b',
      attemptCount: 3,
      fallbackReason: 'RATE_LIMITED',
    });
    expect(message?.run?.requestedModel).toBe('openai/gpt-oss-20b');
  });
});
