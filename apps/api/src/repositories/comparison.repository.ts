import type { PrismaClient } from '../generated/prisma/client.js';
import type { RunStatusValue } from './conversation.repository.js';

/** Persistence for signed-in users' comparisons (Phase 4, ADR-011). Guests use Redis instead. */

export type ComparisonRecord = {
  id: string;
  userId: string;
  prompt: string;
  createdAt: Date;
};

export type ComparisonRunRecord = {
  id: string;
  comparisonId: string;
  position: number;
  provider: string;
  model: string;
  status: RunStatusValue;
  content: string | null;
  ttftMs: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: string | null;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type ComparisonRunTarget = { provider: string; model: string };

export type ComparisonRunCompletion = {
  status: Exclude<RunStatusValue, 'RUNNING'>;
  /** The answer, or null (failure, or nothing produced). */
  content: string | null;
  ttftMs: number | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: 'provider' | 'estimated' | null;
  errorCode: string | null;
  /** From registry prices; null when a price or token count is unknown. */
  estimatedCostUsd: number | null;
  completedAt: Date;
};

export interface ComparisonRepository {
  /** Creates the comparison and one RUNNING run per target, returned in target order. */
  create(data: {
    userId: string;
    prompt: string;
    runs: ComparisonRunTarget[];
  }): Promise<{ comparison: ComparisonRecord; runs: ComparisonRunRecord[] }>;
  /** Null when it does not exist or belongs to someone else. */
  findForUser(id: string, userId: string): Promise<ComparisonRecord | null>;
  /** Adds a RUNNING run after the existing ones (a retried column). */
  addRun(comparisonId: string, target: ComparisonRunTarget): Promise<ComparisonRunRecord>;
  completeRun(runId: string, completion: ComparisonRunCompletion): Promise<ComparisonRunRecord>;
  /** In the order they were started. */
  listRuns(comparisonId: string): Promise<ComparisonRunRecord[]>;
}

export function createPrismaComparisonRepository(prisma: PrismaClient): ComparisonRepository {
  return {
    create: ({ userId, prompt, runs }) =>
      prisma.$transaction(async (tx) => {
        const comparison = await tx.comparison.create({ data: { userId, prompt } });
        const created: ComparisonRunRecord[] = [];
        for (const [position, target] of runs.entries()) {
          created.push(
            await tx.comparisonRun.create({
              data: { comparisonId: comparison.id, position, ...target },
            }),
          );
        }
        return { comparison, runs: created };
      }),

    findForUser: (id, userId) => prisma.comparison.findFirst({ where: { id, userId } }),

    addRun: (comparisonId, target) =>
      prisma.$transaction(async (tx) => {
        const last = await tx.comparisonRun.findFirst({
          where: { comparisonId },
          orderBy: { position: 'desc' },
          select: { position: true },
        });
        return tx.comparisonRun.create({
          data: { comparisonId, position: (last?.position ?? -1) + 1, ...target },
        });
      }),

    completeRun: (runId, completion) =>
      prisma.comparisonRun.update({ where: { id: runId }, data: completion }),

    listRuns: (comparisonId) =>
      prisma.comparisonRun.findMany({ where: { comparisonId }, orderBy: { position: 'asc' } }),
  };
}
