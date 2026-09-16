import type { ChatStreamEvent } from '@a-ai/shared-types';
import {
  attachmentUploadResponseSchema,
  attachmentUrlResponseSchema,
  conversationDetailSchema,
  meResponseSchema,
  parseChatStreamEvent,
} from '@a-ai/validation';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../src/services/container.js';
import { disabledStorage } from '../../src/services/storage/object-storage.js';
import { contains, jpeg, multipartBody, png, svg, type MultipartPart } from '../helpers/images.js';
import {
  createMemoryAttachments,
  createMemoryStorage,
  type MemoryAttachments,
  type MemoryStorage,
} from '../helpers/memory-attachments.js';
import { createMemoryConversations } from '../helpers/memory-conversations.js';
import {
  buildChatTestApp,
  cookieValue,
  testEnv,
  WEB_ORIGIN,
  type ChatTestContext,
} from '../helpers/test-app.js';

const SESSION = 'a_ai_session';
type Cookies = Record<string, string>;
type Context = ChatTestContext & { storage: MemoryStorage; attachments: MemoryAttachments };

let ctx: Context | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

async function setup(
  options: { vision?: boolean; env?: Record<string, string>; services?: ServiceOverrides } = {},
): Promise<Context> {
  const conversations = createMemoryConversations();
  const storage = createMemoryStorage();
  const attachments = createMemoryAttachments(
    (messageId) =>
      conversations.data.messages.find((message) => message.id === messageId)?.conversationId,
  );
  const context = await buildChatTestApp({
    ...(options.env ? { env: testEnv(options.env) } : {}),
    model: { supportsVision: options.vision ?? true },
    services: { conversations, storage, attachments, ...options.services },
  });
  context.provider.setScripts([
    { type: 'delta', text: 'A small red square.' },
    { type: 'done', finishReason: 'stop' },
  ]);
  ctx = { ...context, conversations, storage, attachments };
  return ctx;
}

async function signIn(context: Context, email = 'person@example.com'): Promise<Cookies> {
  await context.app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    headers: { origin: WEB_ORIGIN },
    payload: { firstName: 'Ada', lastName: 'Lovelace', email, password: 'a long enough password' },
  });
  const verified = await context.app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    headers: { origin: WEB_ORIGIN },
    payload: { token: context.emails.tokenFor(email) },
  });
  return { [SESSION]: cookieValue(verified, SESSION)! };
}

const file = (
  data: Uint8Array,
  filename = 'square.png',
  contentType = 'image/png',
): MultipartPart => ({ name: 'file', filename, contentType, data });

function upload(context: Context, cookies: Cookies | undefined, parts: MultipartPart[]) {
  const body = multipartBody(parts);
  return context.app.inject({
    method: 'POST',
    url: '/api/attachments',
    headers: { origin: WEB_ORIGIN, ...body.headers },
    ...(cookies ? { cookies } : {}),
    payload: body.payload,
  });
}

async function uploaded(context: Context, cookies: Cookies, part: MultipartPart = file(png())) {
  const response = await upload(context, cookies, [part]);
  expect(response.statusCode).toBe(201);
  return attachmentUploadResponseSchema.parse(response.json()).attachment;
}

function chat(context: Context, cookies: Cookies | undefined, payload: object) {
  return context.app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: { origin: WEB_ORIGIN },
    ...(cookies ? { cookies } : {}),
    payload: {
      provider: 'scripted',
      model: 'fast-1',
      message: 'What is in this image?',
      ...payload,
    },
  });
}

function events(response: LightMyRequestResponse): ChatStreamEvent[] {
  return response.body
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
      return event && data ? parseChatStreamEvent(event, data) : null;
    })
    .filter((event): event is ChatStreamEvent => event !== null);
}

function conversationIdOf(response: LightMyRequestResponse): string {
  const start = events(response).find((event) => event.event === 'message.start');
  if (start?.event !== 'message.start' || !start.data.conversationId) {
    throw new Error('no conversation started');
  }
  return start.data.conversationId;
}

async function me(context: Context, cookies?: Cookies) {
  const response = await context.app.inject({
    method: 'GET',
    url: '/api/me',
    ...(cookies ? { cookies } : {}),
  });
  return meResponseSchema.parse(response.json());
}

function expectError(response: LightMyRequestResponse, status: number, code: string) {
  expect({ status: response.statusCode, code: response.json().error.code }).toEqual({
    status,
    code,
  });
}

describe('image uploads (Phase 8 gate: validated and securely handled)', () => {
  it('offers uploads to signed-in users only', async () => {
    const context = await setup();
    expect((await me(context)).limits.attachments).toMatchObject({
      enabled: false,
      maxPerMessage: 4,
    });
    const cookies = await signIn(context);
    expect((await me(context, cookies)).limits.attachments).toEqual({
      enabled: true,
      maxBytes: 5_242_880,
      maxPerMessage: 4,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    });

    expectError(await upload(context, undefined, [file(png())]), 401, 'AUTH_REQUIRED');
    expect(context.storage.objects.size).toBe(0);
  });

  it('stores a verified image without metadata under a random private key', async () => {
    const context = await setup();
    const cookies = await signIn(context);

    const attachment = await uploaded(
      context,
      cookies,
      file(png(64, 48, { text: 'GPS 51.5007 -0.1246' }), '../../holiday photo.png'),
    );
    expect(attachment).toMatchObject({
      kind: 'image',
      mimeType: 'image/png',
      width: 64,
      height: 48,
      fileName: 'holiday photo.png',
      source: 'upload',
    });
    const record = context.attachments.data[0]!;
    expect(record.storageKey).toBe(`users/${record.userId}/${attachment.id}.png`);
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
    const stored = context.storage.objects.get(record.storageKey)!;
    expect(stored.contentType).toBe('image/png');
    expect(stored.bytes.length).toBe(attachment.sizeBytes);
    expect(contains(stored.bytes, 'GPS 51.5007')).toBe(false);

    const photo = await uploaded(
      context,
      cookies,
      file(jpeg(20, 10, { exif: 'Canon GPS 48.8584' }), 'photo.jpg', 'image/jpg'),
    );
    expect(photo).toMatchObject({ mimeType: 'image/jpeg', width: 20, height: 10 });
    const storedPhoto = context.storage.objects.get(context.attachments.data[1]!.storageKey)!;
    expect(contains(storedPhoto.bytes, 'Exif')).toBe(false);
  });

  it('rejects anything that is not a supported, honest, reasonably sized image', async () => {
    const context = await setup({ env: { ATTACHMENT_MAX_BYTES: '102400' } });
    const cookies = await signIn(context);

    expectError(
      await upload(context, cookies, [file(svg(), 'x.svg', 'image/svg+xml')]),
      415,
      'VALIDATION_ERROR',
    );
    // A JPEG sent as a PNG: the declared type does not match the bytes.
    expectError(await upload(context, cookies, [file(jpeg())]), 415, 'VALIDATION_ERROR');
    expectError(await upload(context, cookies, [file(png(9000, 10))]), 400, 'VALIDATION_ERROR');
    expectError(await upload(context, cookies, [file(new Uint8Array(0))]), 400, 'VALIDATION_ERROR');

    const oversized = new Uint8Array(150_000);
    oversized.set(png());
    expectError(await upload(context, cookies, [file(oversized)]), 413, 'VALIDATION_ERROR');

    const notMultipart = await context.app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: { origin: WEB_ORIGIN },
      cookies,
      payload: { file: 'x' },
    });
    expectError(notMultipart, 415, 'VALIDATION_ERROR');

    expect(context.storage.objects.size).toBe(0);
    expect(context.attachments.data).toHaveLength(0);
  });

  it('accepts exactly one file part and nothing else', async () => {
    const context = await setup();
    const cookies = await signIn(context);

    const withField = await upload(context, cookies, [
      { name: 'note', data: 'hello' },
      file(png()),
    ]);
    expect(withField.statusCode).toBeGreaterThanOrEqual(400);
    const noFile = await upload(context, cookies, []);
    expect(noFile.statusCode).toBeGreaterThanOrEqual(400);
    expect(context.storage.objects.size).toBe(0);
  });

  it('serves an image only to its owner, through a short-lived signed URL', async () => {
    const context = await setup();
    const owner = await signIn(context, 'owner@example.com');
    const other = await signIn(context, 'other@example.com');
    const attachment = await uploaded(context, owner);

    const mine = await context.app.inject({
      method: 'GET',
      url: `/api/attachments/${attachment.id}/url`,
      cookies: owner,
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['cache-control']).toBe('no-store');
    const signed = attachmentUrlResponseSchema.parse(mine.json());
    expect(signed.url).toContain('token=');
    expect(Date.parse(signed.expiresAt)).toBe(context.clock.now().getTime() + 300_000);

    for (const [url, cookies, status] of [
      [`/api/attachments/${attachment.id}/url`, other, 404],
      ['/api/attachments/not-a-uuid/url', owner, 404],
      [`/api/attachments/${attachment.id}/url`, undefined, 401],
    ] as const) {
      const response = await context.app.inject({
        method: 'GET',
        url,
        ...(cookies ? { cookies } : {}),
      });
      expect(response.statusCode).toBe(status);
    }
  });

  it('rate limits uploads per user', async () => {
    const context = await setup({
      services: {
        rateLimits: { uploadByUser: { name: 'upload-user', limit: 1, windowMs: 60_000 } },
      },
    });
    const cookies = await signIn(context);
    await uploaded(context, cookies);
    expectError(await upload(context, cookies, [file(png())]), 429, 'RATE_LIMITED');
  });

  it('is disabled, not faked, when storage is not configured', async () => {
    const context = await setup({ services: { storage: disabledStorage } });
    const cookies = await signIn(context);
    expect((await me(context, cookies)).limits.attachments.enabled).toBe(false);
    expectError(await upload(context, cookies, [file(png())]), 503, 'MODEL_UNAVAILABLE');
  });
});

describe('vision chat', () => {
  it('sends images to a vision model and saves them with the message', async () => {
    const context = await setup();
    const cookies = await signIn(context);
    const attachment = await uploaded(context, cookies);

    const response = await chat(context, cookies, { attachmentIds: [attachment.id] });
    expect(response.statusCode).toBe(200);
    expect(events(response).some((event) => event.event === 'message.done')).toBe(true);

    const stored = context.storage.objects.get(context.attachments.data[0]!.storageKey)!;
    const sent = context.provider.requests[0]!.messages.at(-1)!;
    expect(sent).toMatchObject({ role: 'user', content: 'What is in this image?' });
    expect(sent.images).toEqual([
      { mimeType: 'image/png', data: Buffer.from(stored.bytes).toString('base64') },
    ]);

    const conversationId = conversationIdOf(response);
    const detail = conversationDetailSchema.parse(
      (
        await context.app.inject({
          method: 'GET',
          url: `/api/conversations/${conversationId}`,
          cookies,
        })
      ).json(),
    );
    expect(detail.messages[0]?.attachments).toEqual([attachment]);
    expect(detail.messages[1]?.attachments).toBeUndefined();

    // Later turns carry text only; an image is sent with one message.
    const again = await chat(context, cookies, { conversationId, attachmentIds: [attachment.id] });
    expectError(again, 400, 'VALIDATION_ERROR');
    expect(again.json().error.message).toContain('already sent');
    const followUp = await chat(context, cookies, { conversationId, message: 'And the colour?' });
    expect(followUp.statusCode).toBe(200);
    expect(context.provider.requests[1]!.messages.some((message) => message.images)).toBe(false);
  });

  it('rejects images for a model without vision before using allowance', async () => {
    const context = await setup({ vision: false });
    const cookies = await signIn(context);
    const attachment = await uploaded(context, cookies);

    const response = await chat(context, cookies, { attachmentIds: [attachment.id] });
    expectError(response, 400, 'VALIDATION_ERROR');
    expect(response.json().error.message).toBe(
      'scripted fast-1 cannot read images. Choose a model that supports images.',
    );
    expect(context.provider.requests).toHaveLength(0);
    expect((await me(context, cookies)).quota.used).toBe(0);
    expect(context.attachments.data[0]?.messageId).toBeNull();
  });

  it("never sends someone else's image, and guests cannot attach", async () => {
    const context = await setup();
    const owner = await signIn(context, 'owner@example.com');
    const other = await signIn(context, 'other@example.com');
    const attachment = await uploaded(context, owner);

    const stolen = await chat(context, other, { attachmentIds: [attachment.id] });
    expectError(stolen, 400, 'VALIDATION_ERROR');
    expect(stolen.json().error.message).toContain('no longer exists');

    const guest = await chat(context, undefined, { attachmentIds: [attachment.id] });
    expectError(guest, 401, 'AUTH_REQUIRED');
    expect(context.provider.requests).toHaveLength(0);
  });

  it('deletes image objects with their conversation', async () => {
    const context = await setup();
    const cookies = await signIn(context);
    const attachment = await uploaded(context, cookies);
    const response = await chat(context, cookies, { attachmentIds: [attachment.id] });
    expect(context.storage.objects.size).toBe(1);

    const deleted = await context.app.inject({
      method: 'DELETE',
      url: `/api/conversations/${conversationIdOf(response)}`,
      headers: { origin: WEB_ORIGIN },
      cookies,
    });
    expect(deleted.statusCode).toBe(204);
    expect(context.storage.objects.size).toBe(0);
  });

  it('cleans up uploads that were never sent within a day', async () => {
    const context = await setup();
    const cookies = await signIn(context);
    const sentImage = await uploaded(context, cookies);
    await chat(context, cookies, { attachmentIds: [sentImage.id] });
    await uploaded(context, cookies);

    expect(await context.app.services.attachments.cleanupUnattached()).toBe(0);
    context.clock.advance(25 * 60 * 60 * 1000);
    expect(await context.app.services.attachments.cleanupUnattached()).toBe(1);
    expect(context.attachments.data.map((record) => record.id)).toEqual([sentImage.id]);
    expect(context.storage.objects.size).toBe(1);
  });
});
