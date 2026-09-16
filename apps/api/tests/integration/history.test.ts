import type { ChatStreamEvent, ComparisonStreamEvent } from '@a-ai/shared-types';
import {
  comparisonDetailSchema,
  conversationRenameResponseSchema,
  conversationRunsResponseSchema,
  historyListResponseSchema,
  parseChatStreamEvent,
  parseComparisonStreamEvent,
  usageReportSchema,
} from '@a-ai/validation';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCompareTestApp,
  cookieValue,
  WEB_ORIGIN,
  type CompareTestContext,
} from '../helpers/test-app.js';

const SESSION = 'a_ai_session';
const say = (text: string) => ({ type: 'delta' as const, text });
const done = { type: 'done' as const, finishReason: 'stop' as const };

let ctx: CompareTestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

async function setup() {
  const context = await buildCompareTestApp();
  context.alpha.setScripts([say('Alpha answer'), done]);
  context.beta.setScripts([say('Beta answer'), done]);
  ctx = context;
  return context;
}

async function signIn(
  context: CompareTestContext,
  email: string,
  options: { admin?: boolean } = {},
) {
  await context.app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    headers: { origin: WEB_ORIGIN },
    payload: { firstName: 'Ada', lastName: 'Lovelace', email, password: 'a long enough password' },
  });
  if (options.admin) await context.repositories.users.setRoleByEmail(email, 'ADMIN');
  const verified = await context.app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    headers: { origin: WEB_ORIGIN },
    payload: { token: context.emails.tokenFor(email) },
  });
  return { [SESSION]: cookieValue(verified, SESSION)! };
}

function sseEvents<T>(
  response: LightMyRequestResponse,
  parse: (event: string, data: string) => T | null,
) {
  return response.body
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
      return event && data ? parse(event, data) : null;
    })
    .filter((event): event is T => event !== null);
}

async function chat(context: CompareTestContext, cookies: Record<string, string>, message: string) {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: { origin: WEB_ORIGIN },
    payload: { provider: 'alpha', model: 'a-1', message },
    cookies,
  });
  const start = sseEvents<ChatStreamEvent>(response, parseChatStreamEvent)[0];
  if (start?.event !== 'message.start') throw new Error('chat did not start');
  return start.data.conversationId as string;
}

async function compare(
  context: CompareTestContext,
  cookies: Record<string, string>,
  prompt: string,
) {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/compare',
    headers: { origin: WEB_ORIGIN },
    payload: {
      prompt,
      models: [
        { provider: 'alpha', model: 'a-1' },
        { provider: 'beta', model: 'b-1' },
      ],
    },
    cookies,
  });
  const start = sseEvents<ComparisonStreamEvent>(response, parseComparisonStreamEvent)[0];
  if (start?.event !== 'comparison.start') throw new Error('comparison did not start');
  return start.data.comparisonId;
}

const get = (context: CompareTestContext, url: string, cookies: Record<string, string> = {}) =>
  context.app.inject({ method: 'GET', url, cookies });

describe('history', () => {
  it("lists the user's chats and comparisons, and nothing for guests or other users", async () => {
    const context = await setup();
    const me = await signIn(context, 'me@example.com');
    const other = await signIn(context, 'other@example.com');
    const conversationId = await chat(context, me, 'Plan a trip to Kyoto');
    const comparisonId = await compare(context, me, 'Which model is faster?');

    expect((await get(context, '/api/history')).statusCode).toBe(401);

    const all = historyListResponseSchema.parse((await get(context, '/api/history', me)).json());
    expect(all.items.map((item) => [item.kind, item.id]).sort()).toEqual(
      [
        ['comparison', comparisonId],
        ['conversation', conversationId],
      ].sort(),
    );

    const search = historyListResponseSchema.parse(
      (await get(context, '/api/history?q=KYOTO', me)).json(),
    );
    expect(search.items.map((item) => item.id)).toEqual([conversationId]);
    const onlyComparisons = historyListResponseSchema.parse(
      (await get(context, '/api/history?type=comparison', me)).json(),
    );
    expect(onlyComparisons.items.map((item) => item.id)).toEqual([comparisonId]);
    expect(
      historyListResponseSchema.parse((await get(context, '/api/history', other)).json()).items,
    ).toEqual([]);

    const runs = conversationRunsResponseSchema.parse(
      (await get(context, `/api/conversations/${conversationId}/runs`, me)).json(),
    );
    expect(runs.runs).toEqual([
      expect.objectContaining({
        status: 'completed',
        provider: 'alpha',
        model: 'a-1',
        requested: null,
      }),
    ]);
    const detail = comparisonDetailSchema.parse(
      (await get(context, `/api/comparisons/${comparisonId}`, me)).json(),
    );
    expect(detail.runs.map((run) => run.content)).toEqual(['Alpha answer', 'Beta answer']);

    expect(
      (await get(context, `/api/conversations/${conversationId}/runs`, other)).statusCode,
    ).toBe(404);
    expect((await get(context, `/api/comparisons/${comparisonId}`, other)).statusCode).toBe(404);
    expect((await get(context, '/api/comparisons/not-a-uuid', me)).statusCode).toBe(404);
    expect((await get(context, '/api/history?limit=500', me)).statusCode).toBe(400);
  });

  it('renames and deletes only the owner’s items', async () => {
    const context = await setup();
    const me = await signIn(context, 'me@example.com');
    const other = await signIn(context, 'other@example.com');
    const conversationId = await chat(context, me, 'Plan a trip');
    const comparisonId = await compare(context, me, 'Compare');

    const rename = (cookies: Record<string, string>, title: string) =>
      context.app.inject({
        method: 'PATCH',
        url: `/api/conversations/${conversationId}`,
        headers: { origin: WEB_ORIGIN },
        payload: { title },
        cookies,
      });
    const renamed = await rename(me, '  Kyoto trip  ');
    expect(conversationRenameResponseSchema.parse(renamed.json()).conversation.title).toBe(
      'Kyoto trip',
    );
    expect((await rename(me, '   ')).statusCode).toBe(400);
    expect((await rename(other, 'Mine now')).statusCode).toBe(404);

    const remove = (url: string, cookies: Record<string, string>) =>
      context.app.inject({ method: 'DELETE', url, headers: { origin: WEB_ORIGIN }, cookies });
    expect((await remove(`/api/conversations/${conversationId}`, other)).statusCode).toBe(404);
    expect((await remove(`/api/conversations/${conversationId}`, me)).statusCode).toBe(204);
    expect((await remove(`/api/conversations/${conversationId}`, me)).statusCode).toBe(404);
    expect((await get(context, `/api/conversations/${conversationId}/runs`, me)).statusCode).toBe(
      404,
    );
    expect((await remove(`/api/comparisons/${comparisonId}`, me)).statusCode).toBe(204);

    expect(
      historyListResponseSchema.parse((await get(context, '/api/history', me)).json()).items,
    ).toEqual([]);
  });

  it('reports usage to each user, and deployment totals only to admins', async () => {
    const context = await setup();
    const me = await signIn(context, 'me@example.com');
    const other = await signIn(context, 'other@example.com');
    const admin = await signIn(context, 'admin@example.com', { admin: true });
    await chat(context, me, 'First');
    await chat(context, other, 'Second');

    const personal = usageReportSchema.parse((await get(context, '/api/usage', me)).json());
    expect(personal).toMatchObject({ scope: 'personal', activeUsers: null, totals: { runs: 1 } });
    expect(personal.byDay).toHaveLength(30);
    expect(
      usageReportSchema.parse((await get(context, '/api/usage?days=7', me)).json()).byDay,
    ).toHaveLength(7);
    expect((await get(context, '/api/usage?days=100', me)).statusCode).toBe(400);
    expect((await get(context, '/api/usage')).statusCode).toBe(401);

    expect((await get(context, '/api/admin/usage', me)).statusCode).toBe(403);
    const deployment = usageReportSchema.parse(
      (await get(context, '/api/admin/usage', admin)).json(),
    );
    expect(deployment).toMatchObject({ scope: 'deployment', activeUsers: 2, totals: { runs: 2 } });
    expect(JSON.stringify(deployment)).not.toContain('me@example.com');
  });
});
