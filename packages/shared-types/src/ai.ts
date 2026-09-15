import type { ErrorCode } from './errors.js';

/** Provider-neutral AI domain types (blueprint sections 7, 11 and 12). */

export type AIRole = 'system' | 'user' | 'assistant';

/** An image sent to a vision model (Phase 8). Base64, no data-URL prefix. */
export type AIImageInput = {
  mimeType: string;
  data: string;
};

export type AIMessage = {
  role: AIRole;
  content: string;
  /** Images for this message; only sent to models that support vision. */
  images?: AIImageInput[];
};

export type AIModelCategory = 'text' | 'vision' | 'image' | 'video' | 'audio';

export type AIModelAvailability = 'free' | 'free-tier' | 'paid';

export type AIModel = {
  /** The provider's own model id, e.g. "openai/gpt-oss-120b". */
  id: string;
  /** Provider key, e.g. "groq". Together with `id` it identifies a model. */
  provider: string;
  name: string;
  category: AIModelCategory;
  contextWindow: number;
  /** Largest reply the model can produce in one response. */
  maxOutputTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  availability: AIModelAvailability;
  /** USD per million input tokens; null when unknown (no cost estimate). */
  inputPricePerMillionUsd: number | null;
  /** USD per million output tokens; null when unknown (no cost estimate). */
  outputPricePerMillionUsd: number | null;
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

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

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
