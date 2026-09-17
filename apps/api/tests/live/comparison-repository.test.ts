import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/plugins/prisma.js';
import {
  createPrismaComparisonRepository,
  type ComparisonRepository,
} from '../../src/repositories/comparison.repository.js';
import { createPrismaRepositories } from '../../src/repositories/prisma.repositories.js';
import { testEnv } from '../helpers/test-app.js';

/** Phase 4 data gate against real Supabase PostgreSQL. */
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Live comparison tests need TEST_DATABASE_URL (Supabase test project).');
}

let prisma: PrismaClient;
let comparisons: ComparisonRepository;
const userIds: string[] = [];

async function newUser(): Promise<string> {
  const user = await createPrismaRepositories(prisma).users.create({
    email: `live-compare-${randomUUID()}@example.test`,
    passwordHash: 'hash',
  });
  userIds.push(user.id);
  return user.id;
}

beforeAll(() => {
  prisma = createPrismaClient(testEnv({ DATABASE_URL: databaseUrl }));
  comparisons = createPrismaComparisonRepository(prisma);
});

afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});

describe('comparison migration', () => {
  it('created the comparison tables with Row Level Security enabled', async () => {
    const rows = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('comparisons', 'comparison_runs') AND relkind = 'r'
      AND relnamespace = 'public'::regnamespace
      ORDER BY relname`;
    expect(rows).toEqual([
      { relname: 'comparison_runs', relrowsecurity: true },
      { relname: 'comparisons', relrowsecurity: true },
    ]);
  });
});

describe('Prisma comparison repository', () => {
  it('keeps runs in request order, records outcomes and appends retries', async () => {
    const userId = await newUser();
    const { comparison, runs } = await comparisons.create({
      userId,
      prompt: 'Explain RAG',
      runs: [
        { provider: 'groq', model: 'openai/gpt-oss-20b' },
        { provider: 'gemini', model: 'gemini-3.8-flash' },
        { provider: 'openrouter', model: 'meta/llama' },
      ],
    });
    expect(runs.map((run) => [run.position, run.provider, run.status])).toEqual([
      [0, 'groq', 'RUNNING'],
      [1, 'gemini', 'RUNNING'],
      [2, 'openrouter', 'RUNNING'],
    ]);

    await comparisons.completeRun(runs[0]!.id, {
      status: 'COMPLETED',
      content: 'answer',
      ttftMs: 120,
      latencyMs: 900,
      inputTokens: 12,
      outputTokens: 30,
      usageSource: 'provider',
      errorCode: null,
      estimatedCostUsd: 0.000123,
      completedAt: new Date(),
    });
    await comparisons.completeRun(runs[1]!.id, {
      status: 'FAILED',
      content: null,
      ttftMs: null,
      latencyMs: 400,
      inputTokens: 12,
      outputTokens: 0,
      usageSource: 'estimated',
      errorCode: 'RATE_LIMITED',
      estimatedCostUsd: null,
      completedAt: new Date(),
    });
    const retry = await comparisons.addRun(comparison.id, {
      provider: 'gemini',
      model: 'gemini-3.8-flash',
    });
    expect(retry.position).toBe(3);

    const stored = await comparisons.listRuns(comparison.id);
    expect(stored.map((run) => [run.position, run.status, run.content, run.errorCode])).toEqual([
      [0, 'COMPLETED', 'answer', null],
      [1, 'FAILED', null, 'RATE_LIMITED'],
      [2, 'RUNNING', null, null],
      [3, 'RUNNING', null, null],
    ]);
    const cost = await prisma.comparisonRun.findUniqueOrThrow({ where: { id: runs[0]!.id } });
    expect(cost.estimatedCostUsd?.toString()).toBe('0.000123');
  });

  it('only returns a comparison to its owner and deletes it with the account', async () => {
    const owner = await newUser();
    const other = await newUser();
    const { comparison } = await comparisons.create({
      userId: owner,
      prompt: 'private',
      runs: [{ provider: 'groq', model: 'openai/gpt-oss-20b' }],
    });

    expect(await comparisons.findForUser(comparison.id, other)).toBeNull();
    expect(await comparisons.findForUser(comparison.id, owner)).toMatchObject({
      prompt: 'private',
    });

    await prisma.user.delete({ where: { id: owner } });
    expect(await prisma.comparisonRun.count({ where: { comparisonId: comparison.id } })).toBe(0);
  });
});
