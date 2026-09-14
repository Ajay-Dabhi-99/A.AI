import type { AIMessage } from '@a-ai/shared-types';
import { describe, expect, it } from 'vitest';
import {
  buildContext,
  estimateMessageTokens,
  estimateTokens,
  MESSAGE_OVERHEAD_TOKENS,
} from '../../src/ai/context-builder.js';
import { AppError } from '../../src/shared/errors/app-error.js';

const user = (content: string): AIMessage => ({ role: 'user', content });
const assistant = (content: string): AIMessage => ({ role: 'assistant', content });
/** A message costing exactly `tokens` estimated tokens. */
const sized = (role: 'user' | 'assistant', tokens: number): AIMessage => ({
  role,
  content: 'x'.repeat((tokens - MESSAGE_OVERHEAD_TOKENS) * 4),
});

describe('token estimation', () => {
  it('rounds characters up to tokens and adds per-message overhead', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateMessageTokens(user('abcd'))).toBe(1 + MESSAGE_OVERHEAD_TOKENS);
  });
});

describe('buildContext', () => {
  it('keeps the whole conversation when it fits, oldest first', () => {
    const history = [user('hi'), assistant('hello'), user('how are you?')];
    const built = buildContext({ history, contextWindow: 10_000, maxOutputTokens: 1_000 });
    expect(built.messages).toEqual(history);
    expect(built.droppedMessages).toBe(0);
  });

  it('puts the system prompt first and counts it', () => {
    const built = buildContext({
      systemPrompt: 'Be concise.',
      history: [user('hi')],
      contextWindow: 10_000,
      maxOutputTokens: 100,
    });
    expect(built.messages[0]).toEqual({ role: 'system', content: 'Be concise.' });
    expect(built.estimatedInputTokens).toBe(
      estimateMessageTokens({ role: 'system', content: 'Be concise.' }) +
        estimateMessageTokens(user('hi')),
    );
  });

  it('drops the oldest messages first and never exceeds the budget', () => {
    // Window 1000 → budget = 950 - 200 = 750 tokens.
    const history = [
      sized('user', 300),
      sized('assistant', 300),
      sized('user', 300),
      sized('assistant', 200),
      sized('user', 200),
    ];
    const built = buildContext({ history, contextWindow: 1_000, maxOutputTokens: 200 });

    expect(built.messages).toEqual(history.slice(2));
    expect(built.estimatedInputTokens).toBe(700);
    expect(built.estimatedInputTokens).toBeLessThanOrEqual(750);
    expect(built.droppedMessages).toBe(2);
  });

  it('keeps kept messages contiguous rather than skipping to smaller old ones', () => {
    const history = [sized('user', 50), sized('assistant', 600), sized('user', 400)];
    const built = buildContext({ history, contextWindow: 1_000, maxOutputTokens: 200 });
    expect(built.messages).toEqual([history[2]]);
  });

  it('never starts the context with an assistant message', () => {
    const history = [sized('user', 400), sized('assistant', 300), sized('user', 400)];
    const built = buildContext({ history, contextWindow: 1_000, maxOutputTokens: 200 });
    expect(built.messages.map((message) => message.role)).toEqual(['user']);
  });

  it('rejects a newest message that cannot fit with CONTEXT_TOO_LARGE', () => {
    const run = () =>
      buildContext({ history: [sized('user', 900)], contextWindow: 1_000, maxOutputTokens: 200 });
    expect(run).toThrow(AppError);
    try {
      run();
    } catch (error) {
      expect(error).toMatchObject({ code: 'CONTEXT_TOO_LARGE', statusCode: 422 });
    }
  });

  it('requires the history to end with a user message', () => {
    expect(() =>
      buildContext({ history: [assistant('hi')], contextWindow: 1_000, maxOutputTokens: 10 }),
    ).toThrow(/ending with a user message/);
  });
});
