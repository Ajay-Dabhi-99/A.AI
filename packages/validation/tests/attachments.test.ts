import { describe, expect, it } from 'vitest';
import {
  ATTACHMENTS_PER_MESSAGE_MAX,
  attachmentSchema,
  chatRequestSchema,
  IMAGE_PROMPT_MAX_LENGTH,
  imageGenerateRequestSchema,
  meResponseSchema,
} from '../src/index.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { provider: 'gemini', model: 'gemini-3.8-flash' };

describe('chat attachments', () => {
  it('accepts up to the per-message maximum of distinct ids with a new message', () => {
    const ids = Array.from({ length: ATTACHMENTS_PER_MESSAGE_MAX }, (_, n) => id(n));
    expect(
      chatRequestSchema.parse({ ...base, message: 'What is this?', attachmentIds: ids })
        .attachmentIds,
    ).toEqual(ids);
  });

  it('rejects too many, duplicate or malformed ids', () => {
    const tooMany = Array.from({ length: ATTACHMENTS_PER_MESSAGE_MAX + 1 }, (_, n) => id(n));
    expect(
      chatRequestSchema.safeParse({ ...base, message: 'x', attachmentIds: tooMany }).success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({ ...base, message: 'x', attachmentIds: [id(1), id(1)] }).success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({ ...base, message: 'x', attachmentIds: ['../../x'] }).success,
    ).toBe(false);
  });

  it('only allows images with a new message, not a retry', () => {
    const result = chatRequestSchema.safeParse({ ...base, retry: true, attachmentIds: [id(1)] });
    expect(result.success).toBe(false);
  });
});

describe('image generation request', () => {
  it('trims the prompt and enforces its length', () => {
    expect(
      imageGenerateRequestSchema.parse({ provider: 'p', model: 'm', prompt: '  a red fox  ' })
        .prompt,
    ).toBe('a red fox');
    expect(
      imageGenerateRequestSchema.safeParse({
        provider: 'p',
        model: 'm',
        prompt: 'x'.repeat(IMAGE_PROMPT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      imageGenerateRequestSchema.safeParse({ provider: 'p', model: 'm', prompt: ' ' }).success,
    ).toBe(false);
    expect(
      imageGenerateRequestSchema.safeParse({ provider: 'p', model: 'm', prompt: 'x', extra: 1 })
        .success,
    ).toBe(false);
  });
});

describe('attachment contracts', () => {
  it('rejects types the API never stores', () => {
    const attachment = {
      id: id(1),
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 10,
      width: 1,
      height: 1,
      fileName: null,
      source: 'upload',
      createdAt: '2026-09-16T00:00:00.000Z',
    };
    expect(attachmentSchema.safeParse(attachment).success).toBe(true);
    expect(attachmentSchema.safeParse({ ...attachment, mimeType: 'image/svg+xml' }).success).toBe(
      false,
    );
  });

  it('requires attachment limits in /api/me', () => {
    const me = {
      identity: { kind: 'guest', expiresAt: '2026-09-16T00:00:00.000Z' },
      quota: { limit: 20, used: 0, remaining: 20, resetsAt: '2026-09-16T00:00:00.000Z' },
      limits: { compareMaxModels: 2 },
    };
    expect(meResponseSchema.safeParse(me).success).toBe(false);
    expect(
      meResponseSchema.safeParse({
        ...me,
        limits: {
          compareMaxModels: 2,
          attachments: { enabled: false, maxBytes: 5, maxPerMessage: 4, mimeTypes: ['image/png'] },
        },
      }).success,
    ).toBe(true);
  });
});
