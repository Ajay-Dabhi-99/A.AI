import { describe, expect, it } from 'vitest';
import {
  chatRequestSchema,
  conversationListResponseSchema,
  conversationSearchQuerySchema,
  conversationShareResponseSchema,
  parseChatStreamEvent,
  sharedConversationSchema,
  shareTokenSchema,
} from '../src/index.js';

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

  it('accepts regenerate on its own and edit with the new text', () => {
    expect(chatRequestSchema.safeParse({ ...base, regenerate: true }).success).toBe(true);
    expect(chatRequestSchema.parse({ ...base, edit: true, message: ' new ' }).message).toBe('new');
  });

  it('refuses mixed or incomplete regenerate and edit requests', () => {
    for (const body of [
      { ...base, regenerate: true, message: 'hi' },
      { ...base, edit: true },
      { ...base, edit: true, retry: true, message: 'hi' },
      { ...base, regenerate: true, retry: true },
      {
        ...base,
        edit: true,
        message: 'hi',
        attachmentIds: ['3f1b8e8a-2d7b-4b8f-9d2a-6f0c1e2b3a4d'],
      },
    ]) {
      expect(chatRequestSchema.safeParse(body).success).toBe(false);
    }
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

describe('conversationSearchQuerySchema (MODEL-071)', () => {
  it('trims and collapses spaces, and needs 2–120 characters', () => {
    expect(conversationSearchQuerySchema.parse({ q: '  hello   world ' })).toEqual({
      q: 'hello world',
    });
    for (const q of [undefined, '', ' a ', 'x'.repeat(121)]) {
      expect(conversationSearchQuerySchema.safeParse({ q }).success).toBe(false);
    }
    expect(conversationSearchQuerySchema.safeParse({ q: '50%' }).success).toBe(true);
  });
});

describe('share contracts (MODEL-070)', () => {
  it('accepts only base64url tokens of a sensible length', () => {
    expect(shareTokenSchema.safeParse('a'.repeat(43)).success).toBe(true);
    expect(shareTokenSchema.safeParse('Ab_-'.repeat(11)).success).toBe(true);
    for (const bad of ['short', 'a'.repeat(65), `${'a'.repeat(42)}/`, `${'a'.repeat(42)}=`]) {
      expect(shareTokenSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('reads a share and a shared chat', () => {
    expect(conversationShareResponseSchema.parse({ share: null })).toEqual({ share: null });
    expect(
      sharedConversationSchema.safeParse({
        title: 'Trip',
        messages: [{ role: 'user', content: 'Hi', model: null }],
        sharedAt: '2026-09-17T10:00:00.000Z',
        truncated: false,
      }).success,
    ).toBe(true);
    expect(
      sharedConversationSchema.safeParse({
        title: 'Trip',
        messages: [{ role: 'system', content: 'secret', model: null }],
        sharedAt: '2026-09-17T10:00:00.000Z',
        truncated: false,
      }).success,
    ).toBe(false);
  });
});

describe('conversationListResponseSchema', () => {
  it('reads pinned chats, and treats a missing pin as unpinned', () => {
    const base = {
      id: 'c1',
      title: 'Trip',
      createdAt: '2026-09-14T09:00:00.000Z',
      updatedAt: '2026-09-14T09:05:00.000Z',
    };
    const parsed = conversationListResponseSchema.parse({
      conversations: [{ ...base, pinnedAt: '2026-09-17T12:00:00.000Z' }, base],
    });
    expect(parsed.conversations.map((chat) => chat.pinnedAt)).toEqual([
      '2026-09-17T12:00:00.000Z',
      null,
    ]);
    expect(
      conversationListResponseSchema.safeParse({ conversations: [{ ...base, pinnedAt: 5 }] })
        .success,
    ).toBe(false);
  });
});
