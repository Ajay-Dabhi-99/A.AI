import type { AuthUser, MeResponse } from '@a-ai/shared-types';
import { QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { AppProviders } from '../../src/app/providers';
import { routes } from '../../src/app/router';

export function renderApp(
  path = '/',
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, router };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: { path: string; message: string }[],
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        retryable: false,
        requestId: 'req-test',
        ...(details ? { details } : {}),
      },
    },
    status,
  );
}

export const readyReport = {
  status: 'ready',
  checks: {
    database: { status: 'up', latencyMs: 12 },
    redis: { status: 'up', latencyMs: 4 },
    providers: { status: 'up', configured: ['groq'] },
  },
} as const;

export const testUser: AuthUser = {
  id: 'user-1',
  email: 'person@example.com',
  emailVerified: true,
  role: 'user',
  createdAt: '2026-09-01T12:00:00.000Z',
};

export const guestMe: MeResponse = {
  identity: { kind: 'guest', expiresAt: '2026-09-14T10:00:00.000Z' },
  quota: { limit: 20, used: 0, remaining: 20, resetsAt: '2026-09-14T00:00:00.000Z' },
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

export const userMe: MeResponse = {
  identity: { kind: 'user', user: testUser },
  quota: { limit: 200, used: 3, remaining: 197, resetsAt: '2026-09-14T00:00:00.000Z' },
  limits: {
    compareMaxModels: 4,
    attachments: {
      enabled: true,
      maxBytes: 5_242_880,
      maxPerMessage: 4,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
  },
};

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * Routes fetch calls by "METHOD /path" (or just "/path" for any method) and
 * builds a fresh Response per call. Unmatched calls get a 404 envelope.
 */
export function mockApi(routesByKey: Record<string, Handler>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, 'http://localhost').pathname;
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${path}`;
    const handler = routesByKey[key] ?? routesByKey[path];
    return handler ? handler(init) : errorResponse(404, 'NOT_FOUND', `No mock for ${key}`);
  });
}

/** Number of fetch calls to "METHOD /path". */
export function callsTo(spy: ReturnType<typeof mockApi>, key: string): RequestInit[] {
  return spy.mock.calls
    .filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return (
        `${(init?.method ?? 'GET').toUpperCase()} ${new URL(url, 'http://localhost').pathname}` ===
        key
      );
    })
    .map(([, init]) => init ?? {});
}

export const baseRoutes = {
  '/ready': () => jsonResponse(readyReport),
  '/api/me': () => jsonResponse(guestMe),
} satisfies Record<string, Handler>;
