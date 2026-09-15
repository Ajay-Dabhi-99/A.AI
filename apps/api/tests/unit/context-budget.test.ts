import type { AIMessage } from '@a-ai/shared-types';
import { describe, expect, it } from 'vitest';
import {
  buildContext,
  contextBudget,
  estimateMessageTokens,
  MESSAGE_OVERHEAD_TOKENS,
  SUMMARY_HEADING,
} from '../../src/ai/context-builder.js';
import { AppError } from '../../src/shared/errors/app-error.js';

const user = (content: string): AIMessage => ({ role: 'user', content });
const assistant = (content: string): AIMessage => ({ role: 'assistant', content });
/** A message costing exactly `tokens` estimated tokens at 4 characters per token. */
const sized = (role: 'user' | 'assistant', tokens: number): AIMessage => ({
  role,
  content: 'x'.repeat((tokens - MESSAGE_OVERHEAD_TOKENS) * 4),
});

/** Small deterministic PRNG (mulberry32), so the generated cases are the same on every run. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('conversation summary in the context', () => {
  it('sends the summary inside the one system message, before the recent messages', () => {
    const built = buildContext({
      systemPrompt: 'Be concise.',
      summary: 'The user is planning a trip to Kyoto.',
      history: [user('Which month is best?')],
      contextWindow: 10_000,
      maxOutputTokens: 500,
    });

    expect(built.summaryIncluded).toBe(true);
    expect(built.messages).toEqual([
      {
        role: 'system',
        content: `Be concise.\n\n${SUMMARY_HEADING}\nThe user is planning a trip to Kyoto.`,
      },
      user('Which month is best?'),
    ]);
  });

  it('leaves the summary out when it does not fit beside the newest message', () => {
    // Budget: 950 - 200 = 750 tokens. The newest message alone uses 700.
    const built = buildContext({
      summary: 's'.repeat(400),
      history: [sized('user', 700)],
      contextWindow: 1_000,
      maxOutputTokens: 200,
    });

    expect(built.summaryIncluded).toBe(false);
    expect(built.messages).toEqual([sized('user', 700)]);
    expect(built.estimatedInputTokens).toBeLessThanOrEqual(built.budgetTokens);
  });

  it('keeps the summary ahead of older messages when space is short', () => {
    // Summary system message: ceil((36 + 1 + 760) / 4) + 4 = 204 tokens.
    const history = [sized('user', 300), sized('assistant', 300), sized('user', 200)];
    const built = buildContext({
      summary: 's'.repeat(760),
      history,
      contextWindow: 1_000,
      maxOutputTokens: 200,
    });

    expect(built.summaryIncluded).toBe(true);
    expect(built.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(built.droppedMessages).toBe(2);
    expect(built.estimatedInputTokens).toBe(404);
  });
});

describe('calibrated characters per token', () => {
  it('counts more tokens for a denser tokenizer, so it trims sooner', () => {
    const history = [user('a'.repeat(1_200)), assistant('b'.repeat(1_200)), user('c'.repeat(400))];
    const standard = buildContext({ history, contextWindow: 1_000, maxOutputTokens: 200 });
    const dense = buildContext({
      history,
      contextWindow: 1_000,
      maxOutputTokens: 200,
      charsPerToken: 2,
    });

    expect(standard.droppedMessages).toBe(0);
    expect(dense.droppedMessages).toBe(2);
    expect(dense.estimatedInputTokens).toBe(204);
  });

  it('rejects a ratio that is not positive', () => {
    expect(() =>
      buildContext({
        history: [user('hi')],
        contextWindow: 1_000,
        maxOutputTokens: 10,
        charsPerToken: 0,
      }),
    ).toThrow(/positive/);
  });
});

describe('budget invariant (Phase 5 gate)', () => {
  it('never exceeds the budget across 5,000 generated conversations', () => {
    const random = prng(20_260_915);
    const pick = (max: number) => Math.floor(random() * max);
    let fitted = 0;
    let rejected = 0;

    for (let round = 0; round < 5_000; round++) {
      const contextWindow = 200 + pick(8_000);
      const maxOutputTokens = pick(Math.floor(contextWindow * 0.6));
      const charsPerToken = 2 + random() * 2;
      const length = 1 + pick(30);
      // Alternating roles, always ending with the user message being answered.
      const history: AIMessage[] = Array.from({ length }, (_, index) => ({
        role: (length - 1 - index) % 2 === 0 ? 'user' : 'assistant',
        content: 'w'.repeat(pick(3_000)),
      }));
      const summary = random() < 0.5 ? 's'.repeat(pick(3_000)) : null;

      try {
        const built = buildContext({
          systemPrompt: 'You are a helpful assistant.',
          summary,
          history,
          contextWindow,
          maxOutputTokens,
          charsPerToken,
        });
        const recounted = built.messages.reduce(
          (sum, message) => sum + estimateMessageTokens(message, charsPerToken),
          0,
        );

        expect(recounted).toBe(built.estimatedInputTokens);
        expect(built.budgetTokens).toBe(contextBudget(contextWindow, maxOutputTokens));
        expect(built.estimatedInputTokens).toBeLessThanOrEqual(built.budgetTokens);
        expect(built.messages.at(-1)).toEqual(history.at(-1));
        expect(built.messages.find((message) => message.role !== 'system')?.role).toBe('user');
        fitted += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ code: 'CONTEXT_TOO_LARGE' });
        rejected += 1;
      }
    }

    // Both outcomes were exercised, not just one.
    expect(fitted).toBeGreaterThan(1_000);
    expect(rejected).toBeGreaterThan(100);
  });
});
