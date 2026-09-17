import { AIProviderError } from '@a-ai/ai-core';
import type { ChatStreamEvent } from '@a-ai/shared-types';
import {
  chatSuggestionsResponseSchema,
  conversationDetailSchema,
  conversationListResponseSchema,
  guestConversationResponseSchema,
  meResponseSchema,
  modelsResponseSchema,
  parseChatStreamEvent,
} from '@a-ai/validation';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildChatTestApp,
  cookieValue,
  setCookieFor,
  testEnv,
  WEB_ORIGIN,
  type ChatTestContext,
} from '../helpers/test-app.js';

const GUEST = 'a_ai_guest';
const SESSION = 'a_ai_session';
const say = (text: string) => ({ type: 'delta' as const, text });
const done = { type: 'done' as const, finishReason: 'stop' as const };

let ctx: ChatTestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

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

function chat(context: ChatTestContext, body: object, cookies: Record<string, string> = {}) {
  return context.app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: { origin: WEB_ORIGIN },
    payload: { provider: 'scripted', model: 'fast-1', ...body },
    cookies,
  });
}

function suggest(context: ChatTestContext, body: object, cookies: Record<string, string> = {}) {
  return context.app.inject({
    method: 'POST',
    url: '/api/chat/suggestions',
    headers: { origin: WEB_ORIGIN },
    payload: body,
    cookies,
  });
}

async function signedInUser(context: ChatTestContext, email = 'person@example.com') {
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
  return cookieValue(verified, SESSION)!;
}

describe('GET /api/models', () => {
  it('lists only configured models and a default', async () => {
    ctx = await buildChatTestApp();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/models' });
    expect(modelsResponseSchema.parse(response.json())).toEqual({
      models: [ctx.model],
      defaultModel: { provider: 'scripted', id: 'fast-1' },
      providers: [{ id: 'scripted', name: 'scripted', configured: true }],
    });
  });
});

describe('POST /api/chat as a guest', () => {
  it('streams normalized events and keeps the chat for the guest', async () => {
    ctx = await buildChatTestApp();
    ctx.provider.setScripts([say('Hello'), say(' guest'), done]);

    const response = await chat(ctx, { message: 'Hi there' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache, no-transform');
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);

    const stream = events(response);
    expect(stream.map((event) => event.event)).toEqual([
      'message.start',
      'message.delta',
      'message.delta',
      'usage',
      'message.done',
    ]);
    expect(
      stream
        .filter((event) => event.event === 'message.delta')
        .map((event) => event.data.text)
        .join(''),
    ).toBe('Hello guest');

    // The guest cookie is issued on the streamed response itself.
    const guest = setCookieFor(response, GUEST);
    expect(guest).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    const saved = await ctx.app.inject({
      method: 'GET',
      url: '/api/guest/conversation',
      cookies: { [GUEST]: guest!.value },
    });
    const body = guestConversationResponseSchema.parse(saved.json());
    expect(body.messages.map((message) => message.content)).toEqual(['Hi there', 'Hello guest']);
  });

  it('refunds the allowance when the provider fails, and retries without repeating the question', async () => {
    ctx = await buildChatTestApp();
    const timeout = {
      type: 'throw' as const,
      error: new AIProviderError({
        provider: 'scripted',
        code: 'PROVIDER_TIMEOUT',
        message: 'Scripted did not respond',
      }),
    };
    // The first request retries once (ADR-013) and has no other model to fall back to.
    ctx.provider.setScripts([timeout], [timeout], [say('Second time lucky'), done]);

    const failed = await chat(ctx, { message: 'Are you there?' });
    const guest = cookieValue(failed, GUEST)!;
    expect(events(failed).at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'PROVIDER_TIMEOUT', retryable: true },
    });

    const me = meResponseSchema.parse(
      (await ctx.app.inject({ method: 'GET', url: '/api/me', cookies: { [GUEST]: guest } })).json(),
    );
    expect(me.quota.used).toBe(0);

    const retried = await chat(ctx, { retry: true }, { [GUEST]: guest });
    expect(events(retried).at(-1)).toMatchObject({
      event: 'message.done',
      data: { status: 'completed' },
    });

    const saved = guestConversationResponseSchema.parse(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/guest/conversation',
          cookies: { [GUEST]: guest },
        })
      ).json(),
    );
    expect(saved.messages.map((message) => message.content)).toEqual([
      'Are you there?',
      'Second time lucky',
    ]);
  });

  it('returns JSON errors, not a stream, for requests that are rejected up front', async () => {
    ctx = await buildChatTestApp({
      env: testEnv({ GUEST_DAILY_MESSAGE_LIMIT: '1' }),
      model: { contextWindow: 300, maxOutputTokens: 50 },
    });
    ctx.provider.setScripts([say('ok'), done]);

    const unknownModel = await chat(ctx, { model: 'nope', message: 'hi' });
    expect(unknownModel.statusCode).toBe(400);
    expect(unknownModel.json().error.code).toBe('MODEL_UNAVAILABLE');

    const tooLong = await chat(ctx, { message: 'x'.repeat(4_000) });
    expect(tooLong.statusCode).toBe(422);
    expect(tooLong.json().error.code).toBe('CONTEXT_TOO_LARGE');

    const invalid = await chat(ctx, {});
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');

    const first = await chat(ctx, { message: 'hi' });
    const guest = cookieValue(first, GUEST)!;
    const second = await chat(ctx, { message: 'again' }, { [GUEST]: guest });
    expect(second.statusCode).toBe(429);
    expect(second.headers['content-type']).toContain('application/json');
    expect(second.json().error.code).toBe('QUOTA_EXCEEDED');
  });
});

describe('POST /api/chat as a signed-in user', () => {
  it('saves conversations that can be listed and reopened', async () => {
    ctx = await buildChatTestApp();
    ctx.provider.setScripts([say('Saved answer'), done]);
    const session = await signedInUser(ctx);

    const first = events(await chat(ctx, { message: 'What is RAG?' }, { [SESSION]: session }));
    const conversationId =
      first[0]?.event === 'message.start' ? first[0].data.conversationId : null;
    expect(conversationId).toEqual(expect.any(String));
    expect(first.at(-1)).toMatchObject({
      data: { status: 'completed', messageId: expect.any(String) },
    });

    await chat(ctx, { message: 'And fine-tuning?', conversationId }, { [SESSION]: session });
    expect(ctx.provider.requests.at(-1)?.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);

    const list = conversationListResponseSchema.parse(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/conversations',
          cookies: { [SESSION]: session },
        })
      ).json(),
    );
    expect(list.conversations).toEqual([
      expect.objectContaining({ id: conversationId, title: 'What is RAG?' }),
    ]);

    const detail = conversationDetailSchema.parse(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/conversations/${conversationId}`,
          cookies: { [SESSION]: session },
        })
      ).json(),
    );
    expect(detail.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(detail.messages[1]?.run).toMatchObject({
      provider: 'scripted',
      model: 'fast-1',
      status: 'completed',
    });
  });

  it("does not reveal other users' conversations", async () => {
    ctx = await buildChatTestApp();
    const owner = await signedInUser(ctx, 'owner@example.com');
    const start = events(await chat(ctx, { message: 'private' }, { [SESSION]: owner }))[0];
    const conversationId = start?.event === 'message.start' ? start.data.conversationId : '';

    const intruder = await signedInUser(ctx, 'intruder@example.com');
    const read = await ctx.app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}`,
      cookies: { [SESSION]: intruder },
    });
    const write = await chat(ctx, { message: 'hijack', conversationId }, { [SESSION]: intruder });
    expect(read.statusCode).toBe(404);
    expect(write.statusCode).toBe(404);

    const guestList = await ctx.app.inject({ method: 'GET', url: '/api/conversations' });
    expect(guestList.statusCode).toBe(401);
  });
});

describe('POST /api/guest/migrate', () => {
  it('moves the guest chat into the new account exactly once', async () => {
    ctx = await buildChatTestApp();
    ctx.provider.setScripts([say('Guest answer'), done]);

    const guestChat = await chat(ctx, { message: 'Keep this after I sign up' });
    const guest = cookieValue(guestChat, GUEST)!;
    const session = await signedInUser(ctx);

    const migrate = () =>
      ctx!.app.inject({
        method: 'POST',
        url: '/api/guest/migrate',
        headers: { origin: WEB_ORIGIN },
        cookies: { [SESSION]: session, [GUEST]: guest },
      });

    const first = await migrate();
    expect(first.statusCode).toBe(200);
    const { conversationId } = first.json() as { conversationId: string };
    expect(conversationId).toEqual(expect.any(String));
    expect(setCookieFor(first, GUEST)?.value).toBe('');

    const detail = conversationDetailSchema.parse(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/conversations/${conversationId}`,
          cookies: { [SESSION]: session },
        })
      ).json(),
    );
    expect(detail.messages.map((message) => message.content)).toEqual([
      'Keep this after I sign up',
      'Guest answer',
    ]);

    expect((await migrate()).json()).toEqual({ conversationId: null });
    expect(ctx.conversations.data.conversations).toHaveLength(1);
  });
});

describe('POST /api/chat/suggestions', () => {
  const body = { question: 'What is a vector database?', answer: 'A database for embeddings.' };

  it('returns follow-up questions to guests and users without using the daily allowance', async () => {
    ctx = await buildChatTestApp();
    ctx.provider.setChatReplies(
      '["How is it indexed?", "Is it free?", "Can I host it?"]',
      '["Which one should I pick?"]',
    );

    const guest = await suggest(ctx, body);
    expect(guest.statusCode).toBe(200);
    expect(chatSuggestionsResponseSchema.parse(guest.json())).toEqual({
      suggestions: ['How is it indexed?', 'Is it free?', 'Can I host it?'],
    });
    const guestCookie = cookieValue(guest, GUEST);
    const me = meResponseSchema.parse(
      (await ctx.app.inject({ url: '/api/me', cookies: { [GUEST]: guestCookie! } })).json(),
    );
    expect(me.quota.used).toBe(0);

    const cookies = { [SESSION]: await signedInUser(ctx) };
    expect(chatSuggestionsResponseSchema.parse((await suggest(ctx, body, cookies)).json())).toEqual(
      {
        suggestions: ['Which one should I pick?'],
      },
    );
  });

  it('answers with an empty list when the model fails, and validates input', async () => {
    ctx = await buildChatTestApp();
    ctx.provider.setChatReplies(new Error('provider down'));
    const failed = await suggest(ctx, body);
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual({ suggestions: [] });

    expect((await suggest(ctx, { question: '', answer: 'x' })).statusCode).toBe(400);
    expect((await suggest(ctx, { ...body, extra: true })).statusCode).toBe(400);
  });

  it('can be turned off', async () => {
    ctx = await buildChatTestApp({ env: testEnv({ CHAT_SUGGESTIONS_ENABLED: 'false' }) });
    expect((await suggest(ctx, body)).json()).toEqual({ suggestions: [] });
    expect(ctx.provider.chatRequests).toHaveLength(0);
  });
});
