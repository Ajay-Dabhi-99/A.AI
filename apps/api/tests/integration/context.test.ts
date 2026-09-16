import type { ChatStreamEvent } from '@a-ai/shared-types';
import { conversationDetailSchema, parseChatStreamEvent } from '@a-ai/validation';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildChatTestApp,
  cookieValue,
  WEB_ORIGIN,
  type ChatTestContext,
} from '../helpers/test-app.js';

const SESSION = 'a_ai_session';
const GUEST = 'a_ai_guest';
const question = (n: number) => `question ${n} `.padEnd(400, '.');

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

function contextOf(response: LightMyRequestResponse) {
  const start = events(response)[0];
  if (start?.event !== 'message.start') throw new Error('expected message.start');
  return start.data.context;
}

async function chat(context: ChatTestContext, body: object, cookies: Record<string, string>) {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: { origin: WEB_ORIGIN },
    payload: { provider: 'scripted', model: 'fast-1', ...body },
    cookies,
  });
  // Summaries run after the stream closes; wait so each turn sees the previous one's summary.
  await context.app.services.context.idle();
  return response;
}

async function signedInUser(context: ChatTestContext) {
  const email = 'long-chat@example.com';
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

function smallModelApp() {
  const summarize = vi.fn(async () => 'The user asked several numbered questions.');
  return {
    summarize,
    app: buildChatTestApp({
      model: { contextWindow: 600, maxOutputTokens: 100 },
      services: { summarizer: { summarize } },
    }),
  };
}

describe('context management over the API', () => {
  it('keeps a long saved conversation within budget and sends its summary', async () => {
    const setup = smallModelApp();
    ctx = await setup.app;
    ctx.provider.setScripts([
      { type: 'delta', text: 'Answer' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const cookies = { [SESSION]: await signedInUser(ctx) };

    const first = await chat(ctx, { message: question(1) }, cookies);
    const firstStart = events(first)[0];
    const conversationId =
      firstStart?.event === 'message.start' ? (firstStart.data.conversationId as string) : '';
    expect(contextOf(first)).toMatchObject({ budgetTokens: 470, contextWindow: 600 });

    const contexts = [contextOf(first)];
    for (let n = 2; n <= 6; n++) {
      contexts.push(contextOf(await chat(ctx, { message: question(n), conversationId }, cookies)));
    }

    for (const context of contexts) {
      expect(context.inputTokens).toBeLessThanOrEqual(context.budgetTokens);
    }
    expect(setup.summarize).toHaveBeenCalled();
    expect(contexts.at(-1)?.summaryIncluded).toBe(true);
    expect(ctx.provider.requests.at(-1)?.messages[0]?.content).toContain(
      'The user asked several numbered questions.',
    );

    // History is never shortened: every message is still saved and shown.
    const detail = conversationDetailSchema.parse(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/conversations/${conversationId}`,
          cookies,
        })
      ).json(),
    );
    expect(detail.messages).toHaveLength(12);
  });

  it("clears a guest's summary when the guest starts a new chat", async () => {
    const setup = smallModelApp();
    ctx = await setup.app;
    ctx.provider.setScripts([
      { type: 'delta', text: 'Answer' },
      { type: 'done', finishReason: 'stop' },
    ]);

    const first = await chat(ctx, { message: question(1) }, {});
    const cookies = { [GUEST]: cookieValue(first, GUEST)! };
    for (let n = 2; n <= 5; n++) await chat(ctx, { message: question(n) }, cookies);
    expect(contextOf(await chat(ctx, { message: question(6) }, cookies)).summaryIncluded).toBe(
      true,
    );

    const cleared = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/guest/conversation',
      headers: { origin: WEB_ORIGIN },
      cookies,
    });
    expect(cleared.statusCode).toBe(204);

    const fresh = contextOf(await chat(ctx, { message: 'hello again' }, cookies));
    expect(fresh).toMatchObject({ summaryIncluded: false, droppedMessages: 0 });
  });
});
