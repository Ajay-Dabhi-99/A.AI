import type { AIUsage, RunError } from './ai.js';

/** Comparison contracts (Phase 4, docs/api/comparison.md, ADR-011). */

/** One model in a comparison request: the provider key and the provider's model id. */
export type ComparisonModelRef = {
  provider: string;
  model: string;
};

/** A run as announced by `comparison.start`, in the order the models were requested. */
export type ComparisonRunInfo = {
  runId: string;
  provider: string;
  model: string;
};

/**
 * Events on the comparison stream. One connection carries every run,
 * multiplexed by `runId`. Every run ends with exactly one `message.done` or
 * `error`; `comparison.done` follows once all of them have ended.
 */
export type ComparisonStreamEventMap = {
  /** `comparisonId` is needed to retry a column. Guest comparisons expire with the guest session. */
  'comparison.start': { comparisonId: string; runs: ComparisonRunInfo[] };
  'message.delta': { runId: string; text: string };
  usage: { runId: string; usage: AIUsage };
  'message.done': {
    runId: string;
    status: 'completed' | 'cancelled';
    /** From backend request start to this event. */
    latencyMs: number;
    /** Time to first token; null when nothing was produced. */
    ttftMs: number | null;
    /** USD from registry prices; null when a price is unknown. */
    estimatedCost: number | null;
  };
  /** This run failed or timed out. Its siblings are not affected. */
  error: { runId: string; status: 'failed' | 'timeout'; latencyMs: number } & RunError;
  'comparison.done': { comparisonId: string };
};

export type ComparisonStreamEventName = keyof ComparisonStreamEventMap;

export type ComparisonStreamEvent = {
  [Name in ComparisonStreamEventName]: { event: Name; data: ComparisonStreamEventMap[Name] };
}[ComparisonStreamEventName];
