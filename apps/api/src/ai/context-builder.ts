import type { AIMessage } from '@a-ai/shared-types';
import { AppError } from '../shared/errors/app-error.js';

/**
 * Bounded, deterministic, provider-independent context (blueprint §10).
 * Phase 2 implements trimming; Phase 5 adds summaries and per-model tokenizers.
 */

/** Conservative average for English text; real tokenizers usually count fewer. */
export const CHARS_PER_TOKEN = 4;
/** Role markers and separators each provider adds around a message. */
export const MESSAGE_OVERHEAD_TOKENS = 4;
/** Headroom for estimation error, as a share of the context window. */
export const SAFETY_MARGIN_RATIO = 0.05;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(message: AIMessage): number {
  return estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS;
}

export type ContextInput = {
  systemPrompt?: string;
  /** Oldest first. The last entry is the user message being answered. */
  history: AIMessage[];
  contextWindow: number;
  /** Tokens reserved for the reply. */
  maxOutputTokens: number;
};

export type BuiltContext = {
  /** Oldest first, ready to send. */
  messages: AIMessage[];
  estimatedInputTokens: number;
  /** Older messages left out to fit the budget. */
  droppedMessages: number;
};

const TOO_LARGE_MESSAGE =
  'Your message is too long for this model. Shorten it or choose a model with a larger context window.';

/**
 * 1. Reserve the system prompt and the reply.
 * 2. Always include the newest message; fail if it cannot fit.
 * 3. Walk older messages newest to oldest while they fit, keeping them contiguous.
 * 4. Drop leading assistant messages so the context starts with the user.
 */
export function buildContext(input: ContextInput): BuiltContext {
  const { systemPrompt, history, contextWindow, maxOutputTokens } = input;
  const latest = history.at(-1);
  if (!latest || latest.role !== 'user') {
    throw new Error('buildContext requires history ending with a user message');
  }

  const budget = Math.floor(contextWindow * (1 - SAFETY_MARGIN_RATIO)) - maxOutputTokens;
  const systemTokens = systemPrompt
    ? estimateMessageTokens({ role: 'system', content: systemPrompt })
    : 0;

  let used = systemTokens + estimateMessageTokens(latest);
  if (used > budget) {
    throw new AppError('CONTEXT_TOO_LARGE', TOO_LARGE_MESSAGE);
  }

  let firstKept = history.length - 1;
  for (let index = history.length - 2; index >= 0; index--) {
    const cost = estimateMessageTokens(history[index] as AIMessage);
    if (used + cost > budget) break;
    used += cost;
    firstKept = index;
  }

  let kept = history.slice(firstKept);
  while (kept[0]?.role === 'assistant') {
    used -= estimateMessageTokens(kept[0]);
    kept = kept.slice(1);
  }

  return {
    messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...kept] : kept,
    estimatedInputTokens: used,
    droppedMessages: history.length - kept.length,
  };
}
