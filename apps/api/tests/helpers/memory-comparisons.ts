import { randomUUID } from 'node:crypto';
import type {
  ComparisonRecord,
  ComparisonRepository,
  ComparisonRunRecord,
} from '../../src/repositories/comparison.repository.js';

export type MemoryComparisonRun = ComparisonRunRecord & { estimatedCostUsd: number | null };

export type MemoryComparisons = ComparisonRepository & {
  data: { comparisons: ComparisonRecord[]; runs: MemoryComparisonRun[] };
};

/** In-memory ComparisonRepository for tests; the Prisma version runs in the live suite. */
export function createMemoryComparisons(): MemoryComparisons {
  const data: MemoryComparisons['data'] = { comparisons: [], runs: [] };
  const at = () => new Date(Date.UTC(2026, 8, 15, 10, 0, 0));

  const newRun = (comparisonId: string, position: number, provider: string, model: string) => {
    const run: MemoryComparisonRun = {
      id: randomUUID(),
      comparisonId,
      position,
      provider,
      model,
      status: 'RUNNING',
      content: null,
      ttftMs: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      usageSource: null,
      errorCode: null,
      estimatedCostUsd: null,
      createdAt: at(),
      completedAt: null,
    };
    data.runs.push(run);
    return { ...run };
  };

  const runsOf = (comparisonId: string) =>
    data.runs
      .filter((run) => run.comparisonId === comparisonId)
      .sort((a, b) => a.position - b.position);

  return {
    data,

    create: async ({ userId, prompt, runs }) => {
      const comparison: ComparisonRecord = { id: randomUUID(), userId, prompt, createdAt: at() };
      data.comparisons.push(comparison);
      return {
        comparison: { ...comparison },
        runs: runs.map((target, position) =>
          newRun(comparison.id, position, target.provider, target.model),
        ),
      };
    },

    findForUser: async (id, userId) => {
      const found = data.comparisons.find(
        (candidate) => candidate.id === id && candidate.userId === userId,
      );
      return found ? { ...found } : null;
    },

    addRun: async (comparisonId, target) =>
      newRun(
        comparisonId,
        (runsOf(comparisonId).at(-1)?.position ?? -1) + 1,
        target.provider,
        target.model,
      ),

    completeRun: async (runId, completion) => {
      const run = data.runs.find((candidate) => candidate.id === runId);
      if (!run) throw new Error(`comparison run ${runId} not found`);
      Object.assign(run, completion);
      return { ...run };
    },

    listRuns: async (comparisonId) => runsOf(comparisonId).map((run) => ({ ...run })),
  };
}
