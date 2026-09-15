/** Usage analytics contracts (Phase 7, docs/api/history.md, ADR-014). */

export type UsageScope = 'personal' | 'deployment';

/** Inclusive UTC days. */
export type UsageRange = {
  from: string;
  to: string;
  days: number;
};

export type UsageTotals = {
  runs: number;
  completedRuns: number;
  /** FAILED and TIMEOUT. */
  failedRuns: number;
  cancelledRuns: number;
  inputTokens: number;
  outputTokens: number;
  /** Runs whose token counts came from the provider rather than an estimate. */
  providerCountedRuns: number;
  /** Sum of known cost estimates, in USD. */
  estimatedCostUsd: number;
  /** Runs that had a cost estimate; the others had an unknown price or usage. */
  costedRuns: number;
  /** Over completed runs; null when there are none. */
  averageLatencyMs: number | null;
  /** Over completed runs; null with fewer than 20. */
  p95LatencyMs: number | null;
  /** Chat runs answered by a fallback model (Phase 6). */
  fallbackRuns: number;
};

export type UsageByModel = UsageTotals & {
  provider: string;
  model: string;
};

export type UsageByDay = {
  /** YYYY-MM-DD, UTC. Every day in the range is present. */
  day: string;
  runs: number;
  failedRuns: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

/** GET /api/usage (personal) and GET /api/admin/usage (deployment) */
export type UsageReport = {
  scope: UsageScope;
  range: UsageRange;
  totals: UsageTotals;
  /** Most runs first. */
  byModel: UsageByModel[];
  /** Oldest first. */
  byDay: UsageByDay[];
  /** Distinct users with runs in the range; deployment scope only. */
  activeUsers: number | null;
};
