import type { AIModel, ChatSuggestionsResponse } from '@a-ai/shared-types';
import type { ChatSuggestionsRequest } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import type { ModelRegistryService } from '../../providers/model-registry.service.js';
import type { ProviderHealthService } from '../../providers/provider-health.service.js';
import type { RateLimiter, RateLimitRule } from '../../services/rate-limit.service.js';

/** Suggestions are optional: a slow model is abandoned, never waited for. */
export const SUGGESTION_TIMEOUT_MS = 12_000;
/** Room for reasoning models (their thinking counts against this) plus three short lines. */
export const SUGGESTION_MAX_OUTPUT_TOKENS = 1_024;
export const SUGGESTION_COUNT = 3;
const SUGGESTION_MIN_LENGTH = 3;
const SUGGESTION_MAX_LENGTH = 120;
/** Fast, generous providers are asked first; the rest follow in registry order. */
const PREFERRED_PROVIDERS = ['groq'];
const MAX_ATTEMPTS = 2;

export const SUGGESTION_SYSTEM_PROMPT = `You suggest what a user might ask next in a chat with an AI assistant.
Given the user's last question and the assistant's answer, write exactly ${SUGGESTION_COUNT} short follow-up questions the user is likely to ask next.
Rules: each is a single question in the user's voice, under 12 words, specific to the answer, and different from the others. Use the language of the conversation.
Reply with only a JSON array of ${SUGGESTION_COUNT} strings and nothing else.`;

export type SuggestionSubject =
  { kind: 'user'; userId: string } | { kind: 'guest'; guestId: string; ipHash: string };

export type SuggestionServiceDeps = {
  enabled: boolean;
  models: Pick<ModelRegistryService, 'available' | 'resolve'>;
  health: Pick<ProviderHealthService, 'downProviders'>;
  rateLimiter: RateLimiter;
  rules: { user: RateLimitRule; guest: RateLimitRule; guestIp: RateLimitRule };
  logger: FastifyBaseLogger;
};

function clean(value: string): string {
  return value
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reads the model's reply: a JSON array when it followed the instructions,
 * otherwise one suggestion per line. Keeps at most three distinct, sensible
 * questions; anything else yields fewer (or none), never an error.
 */
export function parseSuggestions(text: string): string[] {
  let candidates: unknown[] = [];
  const match = /\[[\s\S]*\]/.exec(text);
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      if (Array.isArray(parsed)) candidates = parsed;
    } catch {
      // Fall back to lines below.
    }
  }
  if (candidates.length === 0) candidates = text.split('\n');

  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const suggestion = clean(candidate);
    const key = suggestion.toLowerCase();
    if (
      suggestion.length < SUGGESTION_MIN_LENGTH ||
      suggestion.length > SUGGESTION_MAX_LENGTH ||
      /^[[\]{}]/.test(suggestion) ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    result.push(suggestion);
    if (result.length === SUGGESTION_COUNT) break;
  }
  return result;
}

/** Candidate models: text models of healthy providers, preferred providers first. */
export function suggestionCandidates(available: AIModel[], down: Set<string>): AIModel[] {
  const usable = available.filter(
    (model) => model.category === 'text' && !down.has(model.provider),
  );
  return [
    ...usable.filter((model) => PREFERRED_PROVIDERS.includes(model.provider)),
    ...usable.filter((model) => !PREFERRED_PROVIDERS.includes(model.provider)),
  ];
}

/**
 * Follow-up questions after an answer (MODEL-067). Not charged to the daily
 * message allowance, rate-limited separately, and best effort: when no model
 * answers usefully the result is an empty list.
 */
export class SuggestionService {
  readonly #deps: SuggestionServiceDeps;

  constructor(deps: SuggestionServiceDeps) {
    this.#deps = deps;
  }

  async suggest(
    subject: SuggestionSubject,
    input: ChatSuggestionsRequest,
    signal?: AbortSignal,
  ): Promise<ChatSuggestionsResponse> {
    const { enabled, models, health, rateLimiter, rules, logger } = this.#deps;
    if (!enabled) return { suggestions: [] };
    if (subject.kind === 'user') {
      await rateLimiter.consume(rules.user, `user:${subject.userId}`);
    } else {
      await rateLimiter.consume(rules.guest, `guest:${subject.guestId}`);
      await rateLimiter.consume(rules.guestIp, subject.ipHash);
    }

    const available = await models.available();
    const down = await health.downProviders(new Set(available.map((model) => model.provider)));
    const candidates = suggestionCandidates(available, down).slice(0, MAX_ATTEMPTS);

    for (const candidate of candidates) {
      const timeout = AbortSignal.timeout(SUGGESTION_TIMEOUT_MS);
      try {
        const { provider, model } = await models.resolve(candidate.provider, candidate.id);
        const response = await provider.chat({
          model: model.id,
          messages: [
            { role: 'system', content: SUGGESTION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Question:\n${input.question}\n\nAnswer:\n${input.answer}`,
            },
          ],
          temperature: 0.7,
          maxOutputTokens: Math.min(SUGGESTION_MAX_OUTPUT_TOKENS, model.maxOutputTokens),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const suggestions = parseSuggestions(response.text);
        if (suggestions.length > 0) return { suggestions };
      } catch (error) {
        if (signal?.aborted) return { suggestions: [] };
        logger.warn(
          { err: error, event: 'chat.suggestions.failed', provider: candidate.provider },
          'follow-up suggestions failed',
        );
      }
    }
    return { suggestions: [] };
  }
}
