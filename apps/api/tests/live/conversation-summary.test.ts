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

/** Phase 5 data gate against real Supabase PostgreSQL. */
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Live summary tests need TEST_DATABASE_URL (Supabase test project).');
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

describe('conversation summary columns', () => {
  it('saves a summary only when the coverage it was built on is unchanged', async () => {
    const user = await createPrismaRepositories(prisma).users.create({
      email: `live-summary-${randomUUID()}@example.test`,
      passwordHash: 'hash',
    });
    userIds.push(user.id);
    const conversation = await conversations.create({ userId: user.id, title: 'Long chat' });
    const first = await conversations.addUserMessage(conversation.id, 'first');
    const second = await conversations.addUserMessage(conversation.id, 'second');
    const before = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });

    expect(
      await conversations.updateSummary(conversation.id, {
        summary: 'covers first',
        upToMessageId: first.id,
        updatedAt: new Date(),
        expectedUpToMessageId: null,
      }),
    ).toBe(true);
    // Built on the old (empty) coverage: refused.
    expect(
      await conversations.updateSummary(conversation.id, {
        summary: 'stale',
        upToMessageId: second.id,
        updatedAt: new Date(),
        expectedUpToMessageId: null,
      }),
    ).toBe(false);
    expect(
      await conversations.updateSummary(conversation.id, {
        summary: 'covers both',
        upToMessageId: second.id,
        updatedAt: new Date(),
        expectedUpToMessageId: first.id,
      }),
    ).toBe(true);

    const stored = await conversations.findForUser(conversation.id, user.id);
    expect(stored).toMatchObject({ summary: 'covers both', summaryUpToMessageId: second.id });
    expect(stored?.summaryUpdatedAt).toBeInstanceOf(Date);
    // A summary is not user activity: the conversation keeps its place in the list.
    expect(stored?.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});
