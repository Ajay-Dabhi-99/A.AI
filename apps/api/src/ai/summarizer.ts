import type { AIProvider } from '@a-ai/ai-core';
import type { AIMessage, AIModel } from '@a-ai/shared-types';
import { estimateTokens, SAFETY_MARGIN_RATIO } from './context-builder.js';
import { MIN_CHARS_PER_TOKEN } from './token.service.js';

export const SUMMARY_MAX_OUTPUT_TOKENS = 600;
/** Summaries are cut to this length, so one always fits alongside recent messages. */
export const SUMMARY_MAX_CHARACTERS = 2_400;
/** Upper bound on what one summary request sends, whatever the model allows. */
export const SUMMARY_MAX_TRANSCRIPT_CHARACTERS = 60_000;
export const SUMMARY_TIMEOUT_MS = 30_000;

export const SUMMARY_SYSTEM_PROMPT =
  "You keep a running summary of a conversation between a user and an AI assistant. Merge the previous summary, if there is one, with the new messages into one updated summary. Keep facts, decisions, names, numbers, code identifiers, the user's stated preferences and questions that are still open. Drop greetings and repetition. Do not add anything that is not in the conversation. Write plain text in the language of the conversation, at most 250 words.";

const OMITTED = '[earlier part omitted]\n';

export type SummaryInput = {
  provider: AIProvider;
  model: AIModel;
  /** The summary being extended, or null for the first one. */
  previousSummary: string | null;
  /** Oldest first: the messages to fold into the summary. */
  messages: AIMessage[];
  signal?: AbortSignal;
};

/**
 * The summarization hook (blueprint §16). The chat service depends on this
 * interface only; `ModelSummarizer` is the default implementation.
 */
export interface ConversationSummarizer {
  /** Resolves to the new summary text. Rejects when no usable summary was produced. */
  summarize(input: SummaryInput): Promise<string>;
}

/**
 * The text sent to the summarizing model. When it is too long, the oldest
 * part of the transcript is cut, never the previous summary. Deterministic.
 */
export function summaryTranscript(
  previousSummary: string | null,
  messages: AIMessage[],
  maxCharacters: number,
): string {
  const header = previousSummary
    ? `Previous summary:\n${previousSummary}\n\nNew messages:\n`
    : 'Messages:\n';
  const transcript = messages
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n\n');

  const room = maxCharacters - header.length;
  if (transcript.length <= room) return header + transcript;
  const kept = Math.max(0, room - OMITTED.length);
  return `${header}${OMITTED}${kept > 0 ? transcript.slice(-kept) : ''}`;
}

/** Summarizes with the same model the conversation uses (ADR-012). */
export class ModelSummarizer implements ConversationSummarizer {
  async summarize({
    provider,
    model,
    previousSummary,
    messages,
    signal,
  }: SummaryInput): Promise<string> {
    const maxOutputTokens = Math.min(SUMMARY_MAX_OUTPUT_TOKENS, model.maxOutputTokens);
    const inputBudget =
      Math.floor(model.contextWindow * (1 - SAFETY_MARGIN_RATIO)) -
      maxOutputTokens -
      estimateTokens(SUMMARY_SYSTEM_PROMPT);
    // Sized with the most cautious ratio: the transcript must fit whatever the tokenizer.
    const maxCharacters = Math.min(
      SUMMARY_MAX_TRANSCRIPT_CHARACTERS,
      inputBudget * MIN_CHARS_PER_TOKEN,
    );
    if (maxCharacters < 1_000) throw new Error(`${model.id} is too small to summarize with`);

    const timeout = AbortSignal.timeout(SUMMARY_TIMEOUT_MS);
    const response = await provider.chat({
      model: model.id,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: summaryTranscript(previousSummary, messages, maxCharacters) },
      ],
      maxOutputTokens,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });

    const summary = response.text.trim();
    if (!summary) throw new Error('The model returned an empty summary');
    return summary.length > SUMMARY_MAX_CHARACTERS
      ? `${summary.slice(0, SUMMARY_MAX_CHARACTERS - 1).trimEnd()}…`
      : summary;
  }
}
