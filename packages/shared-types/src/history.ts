import type { RunStatus } from './ai.js';
import type { ConversationSummary } from './chat.js';

/** History, run detail, rename and delete contracts (Phase 7, docs/api/history.md, ADR-014). */

export type HistoryKind = 'conversation' | 'comparison';

export type HistoryModelRef = { provider: string; model: string };

export type HistoryItem = {
  kind: HistoryKind;
  id: string;
  /** The conversation title, or the comparison prompt on one line. */
  title: string;
  createdAt: string;
  /** A conversation's last activity, or a comparison's latest run. */
  lastActivityAt: string;
  runCount: number;
  /** Runs that ended FAILED or TIMEOUT. */
  failedRunCount: number;
  /** Distinct models that ran, in first-use order (at most 6). */
  models: HistoryModelRef[];
  /** Sum of known run cost estimates; null when no run has one. */
  estimatedCostUsd: number | null;
};

/** GET /api/history */
export type HistoryListResponse = {
  items: HistoryItem[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
};

/** One provider call, as shown in run detail. */
export type RunDetail = {
  id: string;
  status: RunStatus;
  /** The model that answered (or last tried). */
  provider: string;
  model: string;
  /** The model the user chose, when a fallback answered instead (Phase 6). */
  requested: HistoryModelRef | null;
  attemptCount: number;
  fallbackReason: string | null;
  ttftMs: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: 'provider' | 'estimated' | null;
  estimatedCostUsd: number | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

/** GET /api/conversations/:id/runs */
export type ConversationRunsResponse = {
  conversation: ConversationSummary;
  /** Oldest first, including failed and cancelled runs that saved no message. */
  runs: (RunDetail & { messageId: string | null })[];
};

/** GET /api/comparisons/:id */
export type ComparisonDetail = {
  id: string;
  prompt: string;
  createdAt: string;
  /** In the order they were started: request order, then retries. */
  runs: (RunDetail & { position: number; content: string | null })[];
};

/** PATCH /api/conversations/:id */
export type ConversationRenameResponse = {
  conversation: ConversationSummary;
};
