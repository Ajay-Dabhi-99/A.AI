import type { AIMessage } from '@a-ai/shared-types';
import { AppError } from '../shared/errors/app-error.js';

/**
 * Bounded, deterministic, provider-independent context (blueprint §10,
 * ADR-012). The estimate never exceeds the budget: a request either fits or
 * fails with CONTEXT_TOO_LARGE before any provider call.
 */

/** Default estimate for English text. Per-model calibration can only lower it (ADR-012). */
export const CHARS_PER_TOKEN = 4;
/** Role markers and separators each provider adds around a message. */
export const MESSAGE_OVERHEAD_TOKENS = 4;
/** Headroom for estimation error, as a share of the context window. */
export const SAFETY_MARGIN_RATIO = 0.05;
export const SUMMARY_HEADING = 'Summary of the earlier conversation:';
/** Conservative per-image input estimate for the catalog's vision models (ADR-015 §5). */
export const IMAGE_TOKEN_ESTIMATE = 1_500;

export function estimateTokens(text: string, charsPerToken: number = CHARS_PER_TOKEN): number {
  return Math.ceil(text.length / charsPerToken);
}

export function estimateMessageTokens(
  message: AIMessage,
  charsPerToken: number = CHARS_PER_TOKEN,
): number {
  return (
    estimateTokens(message.content, charsPerToken) +
    MESSAGE_OVERHEAD_TOKENS +
    (message.images?.length ?? 0) * IMAGE_TOKEN_ESTIMATE
  );
}

/** Tokens a request's prompt may use: the window less the safety margin and the reply. */
export function contextBudget(contextWindow: number, maxOutputTokens: number): number {
  return Math.floor(contextWindow * (1 - SAFETY_MARGIN_RATIO)) - maxOutputTokens;
}

/**
 * The summary travels inside the one system message: not every
 * OpenAI-compatible endpoint accepts a second system message.
 */
export function systemWithSummary(systemPrompt: string | undefined, summary: string): string {
  const block = `${SUMMARY_HEADING}\n${summary}`;
  return systemPrompt ? `${systemPrompt}\n\n${block}` : block;
}

export type ContextInput = {
  systemPrompt?: string;
  /** Durable summary of the messages before `history`. Sent only when it fits. */
  summary?: string | null;
  /** Oldest first. The last entry is the user message being answered. */
  history: AIMessage[];
  contextWindow: number;
  /** Tokens reserved for the reply. */
  maxOutputTokens: number;
  /** Characters per token for this model. Defaults to CHARS_PER_TOKEN. */
  charsPerToken?: number;
};

export type BuiltContext = {
  /** Oldest first, ready to send. */
  messages: AIMessage[];
  estimatedInputTokens: number;
  /** The most input tokens this request may use; `estimatedInputTokens` never exceeds it. */
  budgetTokens: number;
  /** Messages at the start of `history` left out to fit the budget. */
  droppedMessages: number;
  summaryIncluded: boolean;
};

const TOO_LARGE_MESSAGE =
  'Your message is too long for this model. Shorten it or choose a model with a larger context window.';

/**
 * 1. Reserve the reply and the system prompt.
 * 2. Always include the newest message; fail if it cannot fit.
 * 3. Include the summary when it fits alongside the newest message.
 * 4. Walk older messages newest to oldest while they fit, keeping them contiguous.
 * 5. Drop leading assistant messages so the context starts with the user.
 */
export function buildContext(input: ContextInput): BuiltContext {
  const { systemPrompt, summary, history, contextWindow, maxOutputTokens } = input;
  const charsPerToken = input.charsPerToken ?? CHARS_PER_TOKEN;
  if (!(charsPerToken > 0)) throw new Error('charsPerToken must be a positive number');

  const latest = history.at(-1);
  if (!latest || latest.role !== 'user') {
    throw new Error('buildContext requires history ending with a user message');
  }

  const budget = contextBudget(contextWindow, maxOutputTokens);
  const systemTokens = (content: string | undefined) =>
    content ? estimateMessageTokens({ role: 'system', content }, charsPerToken) : 0;
  const latestTokens = estimateMessageTokens(latest, charsPerToken);

  if (systemTokens(systemPrompt) + latestTokens > budget) {
    throw new AppError('CONTEXT_TOO_LARGE', TOO_LARGE_MESSAGE);
  }

  let system = systemPrompt;
  let summaryIncluded = false;
  if (summary) {
    const combined = systemWithSummary(systemPrompt, summary);
    if (systemTokens(combined) + latestTokens <= budget) {
      system = combined;
      summaryIncluded = true;
    }
  }

  let used = systemTokens(system) + latestTokens;
  let firstKept = history.length - 1;
  for (let index = history.length - 2; index >= 0; index--) {
    const cost = estimateMessageTokens(history[index] as AIMessage, charsPerToken);
    if (used + cost > budget) break;
    used += cost;
    firstKept = index;
  }

  let kept = history.slice(firstKept);
  while (kept[0]?.role === 'assistant') {
    used -= estimateMessageTokens(kept[0], charsPerToken);
    kept = kept.slice(1);
  }

  return {
    messages: system ? [{ role: 'system', content: system }, ...kept] : kept,
    estimatedInputTokens: used,
    budgetTokens: budget,
    droppedMessages: history.length - kept.length,
    summaryIncluded,
  };
}
