import type { AIFinishReason, AIMessage, AIModel, AIUsage } from '@a-ai/shared-types';

/**
 * The contract every provider adapter implements (blueprint section 7).
 * Routes, services and UI depend on this interface, never on a provider SDK.
 */

export type AIChatRequest = {
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Aborting cancels the upstream call; adapters must honour it. */
  signal?: AbortSignal;
};

export type AIResponse = {
  provider: string;
  model: string;
  text: string;
  usage: AIUsage;
  finishReason: AIFinishReason;
};

export type AIStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: AIUsage }
  | { type: 'done'; finishReason: AIFinishReason };

export interface AIProvider {
  /** Stable identifier, e.g. "openrouter". Unique within a registry. */
  readonly id: string;
  chat(request: AIChatRequest): Promise<AIResponse>;
  stream(request: AIChatRequest): AsyncIterable<AIStreamChunk>;
  getModels(): Promise<AIModel[]>;
}
