import { describe, expect, it } from 'vitest';
import { conversationUpdateSchema, historyQuerySchema, usageQuerySchema } from '../src/index.js';

describe('historyQuerySchema', () => {
  it('applies defaults and turns a blank search into no search', () => {
    expect(historyQuerySchema.parse({})).toEqual({ type: 'all', limit: 20 });
    expect(historyQuerySchema.parse({ q: '   ', cursor: '' })).toEqual({ type: 'all', limit: 20 });
  });

  it('coerces the page size from the query string and caps it', () => {
    expect(historyQuerySchema.parse({ limit: '5' }).limit).toBe(5);
    expect(historyQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('requires provider and model together', () => {
    expect(historyQuerySchema.safeParse({ provider: 'groq' }).success).toBe(false);
    expect(
      historyQuerySchema.parse({ provider: 'groq', model: 'openai/gpt-oss-20b' }),
    ).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-20b' });
  });

  it('accepts only real dates in order', () => {
    expect(historyQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-15' }).success).toBe(
      true,
    );
    expect(historyQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ from: '15/09/2026' }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ from: '2026-09-15', to: '2026-09-01' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown kind and an overlong search', () => {
    expect(historyQuerySchema.safeParse({ type: 'image' }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ q: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('conversationUpdateSchema', () => {
  it('trims the title, requires one, and rejects extra fields', () => {
    expect(conversationUpdateSchema.parse({ title: '  Trip plans  ' })).toEqual({
      title: 'Trip plans',
    });
    expect(conversationUpdateSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(conversationUpdateSchema.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
    expect(conversationUpdateSchema.safeParse({ title: 'ok', userId: 'someone' }).success).toBe(
      false,
    );
  });

  it('accepts a pinned state alone or with a title, but not an empty update', () => {
    expect(conversationUpdateSchema.parse({ pinned: true })).toEqual({ pinned: true });
    expect(conversationUpdateSchema.parse({ title: 'Trip', pinned: false })).toEqual({
      title: 'Trip',
      pinned: false,
    });
    expect(conversationUpdateSchema.safeParse({}).success).toBe(false);
    expect(conversationUpdateSchema.safeParse({ pinned: 'yes' }).success).toBe(false);
  });
});

describe('usageQuerySchema', () => {
  it('defaults to 30 days and allows 1 to 90', () => {
    expect(usageQuerySchema.parse({})).toEqual({ days: 30 });
    expect(usageQuerySchema.parse({ days: '7' })).toEqual({ days: 7 });
    expect(usageQuerySchema.safeParse({ days: '91' }).success).toBe(false);
    expect(usageQuerySchema.safeParse({ days: '0' }).success).toBe(false);
  });
});
