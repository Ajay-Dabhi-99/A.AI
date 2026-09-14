import { describe, expect, it } from 'vitest';
import { chatRequestSchema, parseChatStreamEvent } from '../src/index.js';

const base = { provider: 'groq', model: 'openai/gpt-oss-20b' };

describe('chatRequestSchema', () => {
  it('accepts a new message and trims it', () => {
    expect(chatRequestSchema.parse({ ...base, message: '  hello  ' }).message).toBe('hello');
  });

  it('accepts a retry without a message', () => {
    expect(chatRequestSchema.safeParse({ ...base, retry: true }).success).toBe(true);
  });

  it('requires exactly one of message or retry', () => {
    expect(chatRequestSchema.safeParse(base).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, retry: true, message: 'hi' }).success).toBe(
      false,
    );
    expect(chatRequestSchema.safeParse({ ...base, message: '   ' }).success).toBe(false);
  });

  it('rejects oversized messages and malformed conversation ids', () => {
    expect(chatRequestSchema.safeParse({ ...base, message: 'x'.repeat(16_001) }).success).toBe(
      false,
    );
    expect(
      chatRequestSchema.safeParse({ ...base, message: 'hi', conversationId: '42' }).success,
    ).toBe(false);
  });
});

describe('parseChatStreamEvent', () => {
  it('parses each known event', () => {
    expect(parseChatStreamEvent('message.delta', '{"runId":"r1","text":"Hi"}')).toEqual({
      event: 'message.delta',
      data: { runId: 'r1', text: 'Hi' },
    });
    expect(
      parseChatStreamEvent(
        'error',
        '{"runId":"r1","code":"PROVIDER_TIMEOUT","message":"slow","retryable":true}',
      ),
    ).toMatchObject({ event: 'error', data: { code: 'PROVIDER_TIMEOUT' } });
  });

  it('returns null for unknown events, bad JSON or wrong shapes', () => {
    expect(parseChatStreamEvent('toString', '{}')).toBeNull();
    expect(parseChatStreamEvent('message.delta', '{oops')).toBeNull();
    expect(parseChatStreamEvent('message.delta', '{"runId":"r1"}')).toBeNull();
  });
});
