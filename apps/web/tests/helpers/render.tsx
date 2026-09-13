import { QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../../src/app/providers';
import { routes } from '../../src/app/router';

export function renderApp(path = '/'): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const readyReport = {
  status: 'ready',
  checks: {
    database: { status: 'up', latencyMs: 12 },
    redis: { status: 'up', latencyMs: 4 },
    providers: { status: 'up', configured: ['groq'] },
  },
} as const;
