import type { Page, Route } from '@playwright/test';

/** API responses for browser smoke tests. Shapes follow packages/shared-types. */

export const guestMe = {
  identity: { kind: 'guest', expiresAt: '2030-01-01T00:00:00.000Z' },
  quota: { limit: 20, used: 0, remaining: 20, resetsAt: '2030-01-01T00:00:00.000Z' },
  limits: {
    compareMaxModels: 2,
    attachments: {
      enabled: false,
      maxBytes: 5_242_880,
      maxPerMessage: 4,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
  },
};

const model = {
  id: 'openai/gpt-oss-20b',
  provider: 'groq',
  name: 'GPT-OSS 20B',
  category: 'text',
  contextWindow: 131_072,
  maxOutputTokens: 65_536,
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: true,
  availability: 'free-tier',
  inputPricePerMillionUsd: null,
  outputPricePerMillionUsd: null,
};

const off = { enabled: false, models: [] };

type Handler = (route: Route) => Promise<void>;

export const json =
  (body: unknown, status = 200): Handler =>
  (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Server-Sent Events, one `event:`/`data:` block per entry. */
export function sse(events: [name: string, data: object][]): Handler {
  const body = events
    .map(
      ([name, data]) => `event: ${name}
data: ${JSON.stringify(data)}

`,
    )
    .join('');
  return (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body });
}

/**
 * Intercepts every API call. Unmocked calls get the API's 404 envelope, so a
 * page that calls something unexpected shows up as a failure, never a hang.
 */
export async function mockApi(page: Page, overrides: Record<string, Handler> = {}): Promise<void> {
  const routes: Record<string, Handler> = {
    'GET /ready': json({
      status: 'ready',
      checks: {
        database: { status: 'up', latencyMs: 3 },
        redis: { status: 'up', latencyMs: 2 },
        providers: { status: 'up', configured: ['groq'] },
      },
    }),
    'GET /api/me': json(guestMe),
    'GET /api/models': json({
      models: [model],
      providers: [{ id: 'groq', name: 'Groq', configured: true }],
      defaultModel: { provider: 'groq', id: model.id },
    }),
    'GET /api/guest/conversation': json({ messages: [], expiresAt: '2030-01-01T00:00:00.000Z' }),
    'GET /api/audio/status': json({
      transcription: { enabled: false, maxBytes: 0, maxDurationSeconds: 120, mimeTypes: [] },
      speech: { mode: 'browser' },
    }),
    'GET /api/image/status': json(off),
    'GET /api/video/status': json(off),
    ...overrides,
  };

  await page.route(
    (url) =>
      url.pathname.startsWith('/api/') || url.pathname === '/ready' || url.pathname === '/health',
    async (route) => {
      const request = route.request();
      const key = `${request.method()} ${new URL(request.url()).pathname}`;
      const handler = routes[key];
      if (handler) return handler(route);
      return json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `No mock for ${key}`,
            retryable: false,
            requestId: 'e2e',
          },
        },
        404,
      )(route);
    },
  );
}
