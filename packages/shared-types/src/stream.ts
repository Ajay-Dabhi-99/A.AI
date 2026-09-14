import type { AIUsage, RunError } from './ai.js';

/**
 * Normalized SSE events emitted by the API (blueprint section 9). Every
 * provider stream is translated into exactly these events before it leaves
 * the server, so the web app has one parser for all providers.
 */
export type ChatStreamEventMap = {
  /** `conversationId` is null for guests, whose chat is not saved. */
  'message.start': {
    runId: string;
    provider: string;
    model: string;
    conversationId: string | null;
  };
  'message.delta': { runId: string; text: string };
  usage: { runId: string; usage: AIUsage };
  /** `messageId` is the saved assistant message (null for guests or when nothing was produced). */
  'message.done': {
    runId: string;
    status: 'completed' | 'cancelled';
    messageId: string | null;
    latencyMs: number;
  };
  error: { runId?: string } & RunError;
};

export type ChatStreamEventName = keyof ChatStreamEventMap;

export type ChatStreamEvent = {
  [Name in ChatStreamEventName]: { event: Name; data: ChatStreamEventMap[Name] };
}[ChatStreamEventName];
