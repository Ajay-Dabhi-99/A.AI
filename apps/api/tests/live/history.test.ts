import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/plugins/prisma.js';
import { createPrismaComparisonRepository } from '../../src/repositories/comparison.repository.js';
import { createPrismaConversationRepository } from '../../src/repositories/conversation.repository.js';
import {
  createPrismaHistoryRepository,
  type HistoryRepository,
} from '../../src/repositories/history.repository.js';
import { createPrismaRepositories } from '../../src/repositories/prisma.repositories.js';
import { testEnv } from '../helpers/test-app.js';

/** Phase 7 data gate against real Supabase PostgreSQL. */
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Live history tests need TEST_DATABASE_URL (Supabase test project).');
}

let prisma: PrismaClient;
let history: HistoryRepository;
const userIds: string[] = [];

async function newUser(): Promise<string> {
  const user = await createPrismaRepositories(prisma).users.create({
    email: `live-history-${randomUUID()}@example.test`,
    passwordHash: 'hash',
  });
  userIds.push(user.id);
  return user.id;
}

async function chatWithRun(userId: string, title: string, cost: number | null, latencyMs: number) {
  const conversations = createPrismaConversationRepository(prisma);
  const conversation = await conversations.create({ userId, title });
  const run = await conversations.startRun({
    conversationId: conversation.id,
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
  });
  await conversations.completeRun(run.id, {
    conversationId: conversation.id,
    status: 'COMPLETED',
    messageContent: 'answer',
    ttftMs: 100,
    latencyMs,
    inputTokens: 40,
    outputTokens: 10,
    usageSource: 'provider',
    errorCode: null,
    estimatedCostUsd: cost,
    completedAt: new Date(),
  });
  return conversation.id;
}

beforeAll(() => {
  prisma = createPrismaClient(testEnv({ DATABASE_URL: databaseUrl }));
  history = createPrismaHistoryRepository(prisma);
});

afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});

describe('traceability gate: every durable run belongs to a user', () => {
  it('enforces NOT NULL cascading foreign keys from runs to users', async () => {
    const constraints = await prisma.$queryRaw<
      {
        table_name: string;
        column_name: string;
        is_nullable: string;
        foreign_table: string;
        delete_rule: string;
      }[]
    >`
      SELECT kcu.table_name, kcu.column_name, col.is_nullable,
             ccu.table_name AS foreign_table, rc.delete_rule
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = kcu.constraint_name
      JOIN information_schema.columns col
        ON col.table_name = kcu.table_name AND col.column_name = kcu.column_name
      WHERE (kcu.table_name, kcu.column_name) IN (
        ('model_runs', 'conversationId'), ('conversations', 'userId'),
        ('comparison_runs', 'comparisonId'), ('comparisons', 'userId'))
      ORDER BY kcu.table_name, kcu.column_name`;

    expect(constraints).toEqual([
      {
        table_name: 'comparison_runs',
        column_name: 'comparisonId',
        is_nullable: 'NO',
        foreign_table: 'comparisons',
        delete_rule: 'CASCADE',
      },
      {
        table_name: 'comparisons',
        column_name: 'userId',
        is_nullable: 'NO',
        foreign_table: 'users',
        delete_rule: 'CASCADE',
      },
      {
        table_name: 'conversations',
        column_name: 'userId',
        is_nullable: 'NO',
        foreign_table: 'users',
        delete_rule: 'CASCADE',
      },
      {
        table_name: 'model_runs',
        column_name: 'conversationId',
        is_nullable: 'NO',
        foreign_table: 'conversations',
        delete_rule: 'CASCADE',
      },
    ]);
  });

  it('has no orphaned runs', async () => {
    const [orphans] = await prisma.$queryRaw<{ chat: number; comparison: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM "model_runs" r
           LEFT JOIN "conversations" c ON c."id" = r."conversationId"
           LEFT JOIN "users" u ON u."id" = c."userId"
           WHERE u."id" IS NULL) AS "chat",
        (SELECT COUNT(*)::int FROM "comparison_runs" r
           LEFT JOIN "comparisons" p ON p."id" = r."comparisonId"
           LEFT JOIN "users" u ON u."id" = p."userId"
           WHERE u."id" IS NULL) AS "comparison"`;
    expect(orphans).toEqual({ chat: 0, comparison: 0 });
  });
});

describe('Prisma history repository', () => {
  it("lists only the user's items, escapes search wildcards and pages by keyset", async () => {
    const me = await newUser();
    const other = await newUser();
    await chatWithRun(me, 'Budget is 50% of revenue', 0.001, 800);
    await chatWithRun(me, 'Budget is 5000 dollars', null, 900);
    await chatWithRun(other, 'Budget of someone else', 0.5, 700);
    await createPrismaComparisonRepository(prisma).create({
      userId: me,
      prompt: 'Budget comparison',
      runs: [{ provider: 'groq', model: 'openai/gpt-oss-20b' }],
    });

    const base = {
      userId: me,
      kind: 'all' as const,
      model: null,
      from: null,
      to: null,
      after: null,
    };
    const all = await history.listItems({ ...base, search: 'budget', limit: 10 });
    expect(all).toHaveLength(3);
    expect(
      (await history.listItems({ ...base, search: '50%', limit: 10 })).map((item) => item.title),
    ).toEqual(['Budget is 50% of revenue']);

    const first = await history.listItems({ ...base, search: null, limit: 2 });
    const last = first.at(-1)!;
    const rest = await history.listItems({
      ...base,
      search: null,
      after: { lastActivityAt: last.lastActivityAt, id: last.id },
      limit: 10,
    });
    expect(new Set([...first, ...rest].map((item) => item.id)).size).toBe(3);
  });

  it('renames and pins without touching updatedAt, and deletes with cascade', async () => {
    const me = await newUser();
    const id = await chatWithRun(me, 'Old', null, 500);
    const before = await prisma.conversation.findUniqueOrThrow({ where: { id } });

    const renamed = await history.updateConversation(id, me, { title: 'New' });
    expect(renamed).toMatchObject({ title: 'New', pinnedAt: null });
    expect(renamed?.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await history.updateConversation(id, randomUUID(), { title: 'Hijack' })).toBeNull();

    const pinnedAt = new Date('2026-09-17T12:00:00.000Z');
    const pinned = await history.updateConversation(id, me, { pinnedAt });
    expect(pinned).toMatchObject({ title: 'New', pinnedAt });
    expect(pinned?.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    const unpinned = await history.updateConversation(id, me, { title: 'Newer', pinnedAt: null });
    expect(unpinned).toMatchObject({ title: 'Newer', pinnedAt: null });

    expect(await history.deleteConversation(id, me)).toBe(true);
    expect(await prisma.modelRun.count({ where: { conversationId: id } })).toBe(0);
    expect(await history.deleteConversation(id, me)).toBe(false);
  });

  it('aggregates usage per model, per day and in total', async () => {
    const me = await newUser();
    await chatWithRun(me, 'A', 0.002, 1_000);
    await chatWithRun(me, 'B', null, 3_000);
    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 86_400_000);

    const { groups, days } = await history.usage({ userId: me, from, to });
    const total = groups.find((group) => group.provider === null);

    expect(total).toMatchObject({
      runs: 2,
      completedRuns: 2,
      inputTokens: 80,
      outputTokens: 20,
      providerCountedRuns: 2,
      costedRuns: 1,
      averageLatencyMs: 2_000,
      activeUsers: 1,
    });
    expect(total?.estimatedCostUsd).toBeCloseTo(0.002);
    expect(groups.filter((group) => group.provider !== null)).toHaveLength(1);
    expect(days.reduce((sum, day) => sum + day.runs, 0)).toBe(2);
  });
});
