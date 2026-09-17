import type { ChatStreamEvent } from '@a-ai/shared-types';
import {
  conversationShareResponseSchema,
  parseChatStreamEvent,
  sharedConversationSchema,
} from '@a-ai/validation';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildChatTestApp,
  cookieValue,
  WEB_ORIGIN,
  type ChatTestContext,
} from '../helpers/test-app.js';

const SESSION = 'a_ai_session';
let ctx: ChatTestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

function startOf(response: LightMyRequestResponse): string {
  const block = response.body.split('\n\n')[0] ?? '';
  const data =
    block
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice(6) ?? '';
  const event = parseChatStreamEvent('message.start', data) as ChatStreamEvent | null;
  return event?.event === 'message.start' ? (event.data.conversationId ?? '') : '';
}

async function signIn(context: ChatTestContext, email: string) {
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

const call = (
  context: ChatTestContext,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  cookies: Record<string, string> = {},
) => context.app.inject({ method, url, headers: { origin: WEB_ORIGIN }, cookies });

describe('share links (MODEL-070)', () => {
  it('creates, reads publicly, updates and stops a share', async () => {
    ctx = await buildChatTestApp();
    ctx.provider.setScripts([
      { type: 'delta', text: 'Jaipur.' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const me = await signIn(ctx, 'me@example.com');
    const started = await ctx.app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: WEB_ORIGIN },
      payload: { provider: 'scripted', model: 'fast-1', message: 'Where to go?' },
      cookies: me,
    });
    const id = startOf(started);
    const shareUrl = `/api/conversations/${id}/share`;

    expect(
      conversationShareResponseSchema.parse((await call(ctx, 'GET', shareUrl, me)).json()),
    ).toEqual({
      share: null,
    });
    const created = await call(ctx, 'POST', shareUrl, me);
    expect(created.statusCode).toBe(200);
    const { share } = conversationShareResponseSchema.parse(created.json());
    expect(share).toMatchObject({ messageCount: 2 });

    // Anyone with the link: no cookies, not indexed, not cached.
    const publicRead = await ctx.app.inject({ method: 'GET', url: `/api/shared/${share!.token}` });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(publicRead.headers['cache-control']).toBe('no-store');
    expect(sharedConversationSchema.parse(publicRead.json())).toMatchObject({
      title: 'Where to go?',
      messages: [
        { role: 'user', content: 'Where to go?', model: null },
        { role: 'assistant', content: 'Jaipur.', model: 'scripted fast-1' },
      ],
    });

    const updated = conversationShareResponseSchema.parse(
      (await call(ctx, 'POST', shareUrl, me)).json(),
    );
    expect(updated.share?.token).toBe(share!.token);

    expect((await call(ctx, 'DELETE', shareUrl, me)).statusCode).toBe(204);
    expect((await ctx.app.inject({ url: `/api/shared/${share!.token}` })).statusCode).toBe(404);
    expect((await call(ctx, 'DELETE', shareUrl, me)).statusCode).toBe(404);
  });

  it('keeps shares to the owner and rejects bad links', async () => {
    ctx = await buildChatTestApp();
    const me = await signIn(ctx, 'me@example.com');
    const other = await signIn(ctx, 'other@example.com');
    const started = await ctx.app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: WEB_ORIGIN },
      payload: { provider: 'scripted', model: 'fast-1', message: 'Private' },
      cookies: me,
    });
    const shareUrl = `/api/conversations/${startOf(started)}/share`;

    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      expect((await call(ctx, method, shareUrl, other)).statusCode).toBe(404);
      expect((await call(ctx, method, shareUrl)).statusCode).toBe(401);
    }
    expect((await call(ctx, 'POST', '/api/conversations/not-a-uuid/share', me)).statusCode).toBe(
      404,
    );
    const bad = await ctx.app.inject({ url: '/api/shared/..%2F..%2Fsecret' });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().error.code).toBe('NOT_FOUND');
    expect((await ctx.app.inject({ url: `/api/shared/${'a'.repeat(43)}` })).statusCode).toBe(404);
  });

  it('refuses to share a chat with no messages', async () => {
    ctx = await buildChatTestApp();
    const me = await signIn(ctx, 'me@example.com');
    const empty = await ctx.conversations.create({
      userId: ctx.repositories.data.users[0]!.id,
      title: 'Empty',
    });
    const response = await call(ctx, 'POST', `/api/conversations/${empty.id}/share`, me);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe('There is nothing to share in this chat yet.');
  });
});
