import { AIProviderError } from '@a-ai/ai-core';
import type { ChatStreamEvent } from '@a-ai/shared-types';
import {
  guestConversationResponseSchema,
  parseChatStreamEvent,
  providerHealthResponseSchema,
} from '@a-ai/validation';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCompareTestApp,
  cookieValue,
  WEB_ORIGIN,
  type CompareTestContext,
} from '../helpers/test-app.js';

const GUEST = 'a_ai_guest';
const say = (text: string) => ({ type: 'delta' as const, text });
const done = { type: 'done' as const, finishReason: 'stop' as const };

let ctx: CompareTestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

function chatEvents(response: LightMyRequestResponse): ChatStreamEvent[] {
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

async function providerHealth(context: CompareTestContext) {
  const response = await context.app.inject({ method: 'GET', url: '/api/providers/health' });
  expect(response.headers['cache-control']).toBe('no-store');
  return providerHealthResponseSchema.parse(response.json()).providers;
}

describe('chat fallback over the API', () => {
  it('answers with the next healthy model, labels it, and marks the provider down', async () => {
    ctx = await buildCompareTestApp();
    ctx.alpha.setScripts([
      {
        type: 'throw',
        error: new AIProviderError({
          provider: 'alpha',
          code: 'RATE_LIMITED',
          message: 'Alpha is rate limiting requests',
          retryAfterSeconds: 30,
        }),
      },
    ]);
    ctx.beta.setScripts([say('Beta stepped in'), done]);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { origin: WEB_ORIGIN },
      payload: { provider: 'alpha', model: 'a-1', message: 'Explain RAG' },
    });
    const events = chatEvents(response);

    expect(events.map((event) => event.event)).toEqual([
      'message.start',
      'message.fallback',
      'message.delta',
      'usage',
      'message.done',
    ]);
    expect(events[1]).toMatchObject({
      data: {
        from: { provider: 'alpha', model: 'a-1' },
        to: { provider: 'beta', model: 'b-1' },
        code: 'RATE_LIMITED',
        reason: 'Alpha is rate limiting requests',
      },
    });

    const guest = cookieValue(response, GUEST)!;
    const saved = guestConversationResponseSchema.parse(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/guest/conversation',
          cookies: { [GUEST]: guest },
        })
      ).json(),
    );
    expect(saved.messages[1]?.run).toMatchObject({
      provider: 'beta',
      model: 'b-1',
      fallbackFrom: { provider: 'alpha', model: 'a-1' },
    });

    const health = await providerHealth(ctx);
    expect(health.find((provider) => provider.id === 'alpha')).toMatchObject({
      status: 'down',
      lastErrorCode: 'RATE_LIMITED',
      retryAt: expect.any(String),
    });
    expect(health.find((provider) => provider.id === 'beta')?.status).toBe('healthy');
  });

  it('counts comparison failures towards provider health without falling back', async () => {
    ctx = await buildCompareTestApp();
    ctx.alpha.setScripts([
      {
        type: 'throw',
        error: new AIProviderError({
          provider: 'alpha',
          code: 'PROVIDER_BAD_RESPONSE',
          message: 'Alpha sent an unreadable answer',
        }),
      },
    ]);
    ctx.beta.setScripts([say('Beta answer'), done]);

    const compared = await ctx.app.inject({
      method: 'POST',
      url: '/api/compare',
      headers: { origin: WEB_ORIGIN },
      payload: {
        prompt: 'Explain RAG',
        models: [
          { provider: 'alpha', model: 'a-1' },
          { provider: 'beta', model: 'b-1' },
        ],
      },
    });
    expect(compared.body).toContain('event: error');
    expect(ctx.gamma.requests).toHaveLength(0);

    const health = await providerHealth(ctx);
    expect(health.find((provider) => provider.id === 'alpha')).toMatchObject({
      status: 'degraded',
      consecutiveFailures: 1,
      lastErrorCode: 'PROVIDER_BAD_RESPONSE',
    });
    expect(health.find((provider) => provider.id === 'beta')?.status).toBe('healthy');
  });
});
