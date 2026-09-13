import type { ErrorCode } from './errors.js';

/** Provider-neutral AI domain types (blueprint sections 7, 11 and 12). */

export type AIRole = 'system' | 'user' | 'assistant';

export type AIMessage = {
  role: AIRole;
  content: string;
};

export type AIModelCategory = 'text' | 'vision' | 'image' | 'video' | 'audio';

export type AIModelAvailability = 'free' | 'free-tier' | 'paid';

export type AIModel = {
  id: string;
  provider: string;
  name: string;
  category: AIModelCategory;
  contextWindow: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  availability: AIModelAvailability;
};

/**
 * Token usage for one run. `source` makes estimation explicit: the UI must be
 * able to label numbers that did not come from the provider.
 */
export type AIUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  source: 'provider' | 'estimated';
};

export type AIFinishReason = 'stop' | 'length' | 'content_filter' | 'cancelled' | 'unknown';

export type RunStatus = 'running' | 'completed' | 'failed' | 'timeout';

export type RunError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
};

export type ComparisonRun = {
  runId: string;
  provider: string;
  model: string;
  status: RunStatus;
  text?: string;
  latencyMs?: number;
  usage?: AIUsage;
  estimatedCost?: number;
  error?: RunError;
};

export type GenerationJobKind = 'image' | 'video' | 'audio';

export type GenerationJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type GenerationJob = {
  id: string;
  kind: GenerationJobKind;
  provider: string;
  model: string;
  status: GenerationJobStatus;
  progress?: number;
  outputUrl?: string;
  error?: string;
};
