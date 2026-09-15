import { AIProviderError } from '@a-ai/ai-core';
import type { ComparisonStreamEvent } from '@a-ai/shared-types';
import { meResponseSchema, parseComparisonStreamEvent } from '@a-ai/validation';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCompareTestApp,
  cookieValue,
  setCookieFor,
  testEnv,
  WEB_ORIGIN,
  type CompareTestContext,
} from '../helpers/test-app.js';

const GUEST = 'a_ai_guest';
const SESSION = 'a_ai_session';
const say = (text: string) => ({ type: 'delta' as const, text });
const done = { type: 'done' as const, finishReason: 'stop' as const };
const ALPHA = { provider: 'alpha', model: 'a-1' };
const BETA = { provider: 'beta', model: 'b-1' };
const GAMMA = { provider: 'gamma', model: 'g-1' };
const badResponse = {
  type: 'throw' as const,
  error: new AIProviderError({
    provider: 'alpha',
    code: 'PROVIDER_BAD_RESPONSE',
    message: 'Alpha sent an unreadable answer',
  }),
};

let ctx: CompareTestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

function events(response: LightMyRequestResponse): ComparisonStreamEvent[] {
  return response.body
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
      return event && data ? parseComparisonStreamEvent(event, data) : null;
    })
    .filter((event): event is ComparisonStreamEvent => event !== null);
}

function compare(context: CompareTestContext, body: object, cookies: Record<string, string> = {}) {
  return context.app.inject({
    method: 'POST',
    url: '/api/compare',
    headers: { origin: WEB_ORIGIN },
    payload: { prompt: 'Explain RAG', ...body },
    cookies,
  });
}

function retryRun(
  context: CompareTestContext,
  comparisonId: string,
  body: object,
  cookies: Record<string, string> = {},
) {
  return context.app.inject({
    method: 'POST',
    url: `/api/compare/${comparisonId}/runs`,
    headers: { origin: WEB_ORIGIN },
    payload: body,
    cookies,
  });
}

async function me(context: CompareTestContext, cookies: Record<string, string>) {
  return meResponseSchema.parse(
    (await context.app.inject({ method: 'GET', url: '/api/me', cookies })).json(),
  );
}

async function signedInUser(context: CompareTestContext, email = 'person@example.com') {
  await context.app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    headers: { origin: WEB_ORIGIN },
    payload: { email, password: 'a long enough password' },
  });
  const verified = await context.app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    headers: { origin: WEB_ORIGIN },
    payload: { token: context.emails.tokenFor(email) },
  });
  return cookieValue(verified, SESSION)!;
}

function startOf(stream: ComparisonStreamEvent[]) {
  const first = stream[0];
  if (first?.event !== 'comparison.start')
    throw new Error('stream did not start with comparison.start');
  return first.data;
}

describe('POST /api/compare as a guest', () => {
  it('streams both models on one connection and isolates a failed model', async () => {
    ctx = await buildCompareTestApp();
    ctx.alpha.setScripts([badResponse]);
    ctx.beta.setScripts([say('Retrieval'), say('-augmented'), done]);

    const response = await compare(ctx, { models: [ALPHA, BETA] });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(setCookieFor(response, GUEST)).toMatchObject({ httpOnly: true });

    const stream = events(response);
    const { comparisonId, runs } = startOf(stream);
    expect(runs.map((run) => run.provider)).toEqual(['alpha', 'beta']);
    expect(stream.at(-1)).toEqual({ event: 'comparison.done', data: { comparisonId } });

    const alphaEvents = stream.filter(
      (event) => 'runId' in event.data && event.data.runId === runs[0]!.runId,
    );
    expect(alphaEvents.map((event) => event.event)).toEqual(['error']);
    expect(alphaEvents[0]).toMatchObject({
      data: { status: 'failed', code: 'PROVIDER_BAD_RESPONSE', retryable: false },
    });

    const betaEvents = stream.filter(
      (event) => 'runId' in event.data && event.data.runId === runs[1]!.runId,
    );
    expect(betaEvents.map((event) => event.event)).toEqual([
      'message.delta',
      'message.delta',
      'usage',
      'message.done',
    ]);

    const guest = cookieValue(response, GUEST)!;
    const status = await me(ctx, { [GUEST]: guest });
    // The failed model's message was given back.
    expect(status.quota.used).toBe(1);
    expect(status.limits).toEqual({ compareMaxModels: 2 });
  });

  it('returns JSON errors before streaming and uses no allowance', async () => {
    ctx = await buildCompareTestApp({ env: testEnv({ GUEST_DAILY_MESSAGE_LIMIT: '1' }) });

    const tooMany = await compare(ctx, { models: [ALPHA, BETA, GAMMA] });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('Guests can compare up to 2 models'),
    });
    const guest = cookieValue(tooMany, GUEST)!;
    const cookies = { [GUEST]: guest };

    const single = await compare(ctx, { models: [ALPHA] }, cookies);
    expect(single.statusCode).toBe(400);
    expect(single.json().error.code).toBe('VALIDATION_ERROR');

    const duplicate = await compare(ctx, { models: [ALPHA, ALPHA] }, cookies);
    expect(duplicate.statusCode).toBe(400);

    const unknown = await compare(
      ctx,
      { models: [ALPHA, { provider: 'beta', model: 'nope' }] },
      cookies,
    );
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('MODEL_UNAVAILABLE');

    const overQuota = await compare(ctx, { models: [ALPHA, BETA] }, cookies);
    expect(overQuota.statusCode).toBe(429);
    expect(overQuota.headers['content-type']).toContain('application/json');
    expect(overQuota.json().error.code).toBe('QUOTA_EXCEEDED');

    expect(ctx.alpha.requests).toHaveLength(0);
    expect((await me(ctx, cookies)).quota.used).toBe(0);
  });

  it('retries a column of the same guest comparison, and no one else can', async () => {
    ctx = await buildCompareTestApp();
    ctx.alpha.setScripts([badResponse], [say('Better'), done]);
    ctx.beta.setScripts([say('Fine'), done]);

    const first = await compare(ctx, { models: [ALPHA, BETA] });
    const guest = cookieValue(first, GUEST)!;
    const { comparisonId } = startOf(events(first));

    const retried = events(await retryRun(ctx, comparisonId, ALPHA, { [GUEST]: guest }));
    expect(startOf(retried).runs).toEqual([
      { runId: expect.any(String), provider: 'alpha', model: 'a-1' },
    ]);
    expect(retried.at(-2)).toMatchObject({ event: 'message.done', data: { status: 'completed' } });

    const stranger = await retryRun(ctx, comparisonId, ALPHA);
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json().error.code).toBe('NOT_FOUND');

    const malformed = await retryRun(ctx, 'not-a-uuid', ALPHA, { [GUEST]: guest });
    expect(malformed.statusCode).toBe(404);
  });
});

describe('POST /api/compare as a signed-in user', () => {
  it('saves every run, allows four models, and retries only the owner', async () => {
    ctx = await buildCompareTestApp();
    ctx.alpha.setScripts([badResponse], [say('Recovered'), done]);
    ctx.beta.setScripts([say('Beta answer'), done]);
    ctx.gamma.setScripts([say('Gamma answer'), done]);
    const session = await signedInUser(ctx);
    const cookies = { [SESSION]: session };

    expect((await me(ctx, cookies)).limits).toEqual({ compareMaxModels: 4 });

    const stream = events(await compare(ctx, { models: [ALPHA, BETA, GAMMA] }, cookies));
    const { comparisonId } = startOf(stream);
    expect(ctx.comparisons.data.comparisons).toEqual([
      expect.objectContaining({ id: comparisonId, prompt: 'Explain RAG' }),
    ]);
    expect(ctx.comparisons.data.runs.map((run) => [run.provider, run.status, run.content])).toEqual(
      [
        ['alpha', 'FAILED', null],
        ['beta', 'COMPLETED', 'Beta answer'],
        ['gamma', 'COMPLETED', 'Gamma answer'],
      ],
    );

    const retried = await retryRun(ctx, comparisonId, ALPHA, cookies);
    expect(events(retried).at(-2)).toMatchObject({
      event: 'message.done',
      data: { status: 'completed' },
    });
    expect((await ctx.comparisons.listRuns(comparisonId)).at(-1)).toMatchObject({
      provider: 'alpha',
      status: 'COMPLETED',
      content: 'Recovered',
      position: 3,
    });

    const intruder = await signedInUser(ctx, 'intruder@example.com');
    const hijack = await retryRun(ctx, comparisonId, ALPHA, { [SESSION]: intruder });
    expect(hijack.statusCode).toBe(404);
    expect(await ctx.comparisons.listRuns(comparisonId)).toHaveLength(4);
  });
});
