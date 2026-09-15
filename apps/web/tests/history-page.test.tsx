import type {
  ComparisonDetail,
  ConversationRunsResponse,
  HistoryItem,
  MeResponse,
  UsageReport,
} from '@a-ai/shared-types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  baseRoutes,
  callsTo,
  jsonResponse,
  mockApi,
  renderApp,
  testUser,
  userMe,
} from './helpers/render';

const adminMe: MeResponse = {
  ...userMe,
  identity: { kind: 'user', user: { ...testUser, role: 'admin' } },
};

const chatItem: HistoryItem = {
  kind: 'conversation',
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Kyoto trip',
  createdAt: '2026-09-14T09:00:00.000Z',
  lastActivityAt: '2026-09-15T09:00:00.000Z',
  runCount: 3,
  failedRunCount: 1,
  models: [{ provider: 'groq', model: 'openai/gpt-oss-20b' }],
  estimatedCostUsd: 0.0021,
};

const comparisonItem: HistoryItem = {
  kind: 'comparison',
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Which model is faster?',
  createdAt: '2026-09-13T09:00:00.000Z',
  lastActivityAt: '2026-09-13T09:05:00.000Z',
  runCount: 2,
  failedRunCount: 0,
  models: [
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'gemini', model: 'gemini-3.8-flash' },
  ],
  estimatedCostUsd: null,
};

const olderItem: HistoryItem = {
  ...chatItem,
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Older chat',
  lastActivityAt: '2026-09-01T09:00:00.000Z',
};

const signedIn = { ...baseRoutes, '/api/me': () => jsonResponse(userMe) };

const requestedUrls = (api: ReturnType<typeof mockApi>) =>
  api.mock.calls.map(([input]) => new URL(String(input), 'http://localhost'));

describe('history page', () => {
  it('lists saved chats and comparisons, searches and loads more', async () => {
    let page = 0;
    const api = mockApi({
      ...signedIn,
      'GET /api/history': () => {
        page += 1;
        return page === 1
          ? jsonResponse({ items: [chatItem, comparisonItem], nextCursor: 'cursor-1' })
          : jsonResponse({ items: [olderItem], nextCursor: null });
      },
    });
    renderApp('/history');

    const list = await screen.findByRole('list', { name: 'History' });
    expect(within(list).getByRole('link', { name: 'Kyoto trip' })).toHaveAttribute(
      'href',
      `/chat/${chatItem.id}`,
    );
    expect(within(list).getByRole('link', { name: 'Which model is faster?' })).toHaveAttribute(
      'href',
      `/history/comparisons/${comparisonItem.id}`,
    );
    expect(within(list).getByText(/3 runs · 1 failed · \$0\.0021 est\./)).toBeInTheDocument();
    // An unknown cost is a dash, never "$0".
    expect(within(list).getByText(/2 runs · — est\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await within(list).findByRole('link', { name: 'Older chat' })).toBeInTheDocument();
    expect(requestedUrls(api).some((url) => url.searchParams.get('cursor') === 'cursor-1')).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'kyoto' } });
    await waitFor(() =>
      expect(requestedUrls(api).some((url) => url.searchParams.get('q') === 'kyoto')).toBe(true),
    );
  });

  it('renames a chat and deletes an item after confirmation', async () => {
    let items = [chatItem, comparisonItem];
    const api = mockApi({
      ...signedIn,
      'GET /api/history': () => jsonResponse({ items, nextCursor: null }),
      'PATCH /api/conversations/11111111-1111-4111-8111-111111111111': (init) => {
        const { title } = JSON.parse(String(init?.body)) as { title: string };
        items = items.map((item) => (item.id === chatItem.id ? { ...item, title } : item));
        return jsonResponse({
          conversation: {
            id: chatItem.id,
            title,
            createdAt: chatItem.createdAt,
            updatedAt: chatItem.lastActivityAt,
          },
        });
      },
      'DELETE /api/comparisons/22222222-2222-4222-8222-222222222222': () => {
        items = items.filter((item) => item.id !== comparisonItem.id);
        return new Response(null, { status: 204 });
      },
    });
    renderApp('/history');

    const list = await screen.findByRole('list', { name: 'History' });
    const chatRow = within(list)
      .getByRole('link', { name: 'Kyoto trip' })
      .closest('li') as HTMLElement;
    fireEvent.click(within(chatRow).getByRole('button', { name: 'Rename' }));
    fireEvent.change(within(chatRow).getByLabelText('New title'), {
      target: { value: 'Autumn in Kyoto' },
    });
    fireEvent.click(within(chatRow).getByRole('button', { name: 'Save' }));
    expect(await within(list).findByRole('link', { name: 'Autumn in Kyoto' })).toBeInTheDocument();

    const comparisonRow = within(list)
      .getByRole('link', { name: 'Which model is faster?' })
      .closest('li') as HTMLElement;
    fireEvent.click(within(comparisonRow).getByRole('button', { name: 'Delete' }));
    const confirm = within(comparisonRow).getByRole('alertdialog', { name: 'Delete comparison' });
    expect(callsTo(api, `DELETE /api/comparisons/${comparisonItem.id}`)).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() =>
      expect(
        within(list).queryByRole('link', { name: 'Which model is faster?' }),
      ).not.toBeInTheDocument(),
    );
    expect(callsTo(api, `DELETE /api/comparisons/${comparisonItem.id}`)).toHaveLength(1);
  });

  it('shows an empty state and sends guests to sign in', async () => {
    mockApi({
      ...signedIn,
      'GET /api/history': () => jsonResponse({ items: [], nextCursor: null }),
    });
    const { router } = renderApp('/history');
    expect(await screen.findByText('No history yet.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/history');
  });

  it('redirects a guest to sign in', async () => {
    mockApi({ ...baseRoutes });
    const { router } = renderApp('/history');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});

describe('run detail', () => {
  it('lists every run of a chat, including a failure and a fallback', async () => {
    const runs: ConversationRunsResponse = {
      conversation: {
        id: chatItem.id,
        title: 'Kyoto trip',
        createdAt: chatItem.createdAt,
        updatedAt: chatItem.lastActivityAt,
      },
      runs: [
        {
          id: 'run-1',
          status: 'failed',
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          requested: null,
          attemptCount: 2,
          fallbackReason: null,
          ttftMs: null,
          latencyMs: 900,
          inputTokens: null,
          outputTokens: null,
          usageSource: null,
          estimatedCostUsd: null,
          errorCode: 'PROVIDER_TIMEOUT',
          createdAt: '2026-09-15T09:00:00.000Z',
          completedAt: '2026-09-15T09:00:01.000Z',
          messageId: null,
        },
        {
          id: 'run-2',
          status: 'completed',
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          requested: { provider: 'groq', model: 'openai/gpt-oss-20b' },
          attemptCount: 3,
          fallbackReason: 'RATE_LIMITED',
          ttftMs: 320,
          latencyMs: 2_150,
          inputTokens: 1_200,
          outputTokens: 300,
          usageSource: 'estimated',
          estimatedCostUsd: 0.0012,
          errorCode: null,
          createdAt: '2026-09-15T09:01:00.000Z',
          completedAt: '2026-09-15T09:01:02.000Z',
          messageId: 'message-2',
        },
      ],
    };
    mockApi({
      ...signedIn,
      [`GET /api/conversations/${chatItem.id}/runs`]: () => jsonResponse(runs),
    });
    renderApp(`/history/chats/${chatItem.id}`);

    const table = await screen.findByRole('table');
    const [, failed, fallback] = within(table).getAllByRole('row');
    expect(within(failed!).getByText('Failed')).toBeInTheDocument();
    expect(within(failed!).getByText('PROVIDER_TIMEOUT')).toBeInTheDocument();
    expect(
      within(fallback!).getByText('Fallback for openai/gpt-oss-20b (RATE_LIMITED)'),
    ).toBeInTheDocument();
    expect(within(fallback!).getByText('estimated')).toBeInTheDocument();
    expect(within(fallback!).getByText('2.15 s')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open chat' })).toHaveAttribute(
      'href',
      `/chat/${chatItem.id}`,
    );
  });

  it('reopens a saved comparison read-only', async () => {
    const detail: ComparisonDetail = {
      id: comparisonItem.id,
      prompt: 'Which model is faster?',
      createdAt: comparisonItem.createdAt,
      runs: [
        {
          id: 'c-run-1',
          position: 0,
          content: 'Groq answered quickly.',
          status: 'completed',
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          requested: null,
          attemptCount: 1,
          fallbackReason: null,
          ttftMs: 120,
          latencyMs: 800,
          inputTokens: 40,
          outputTokens: 12,
          usageSource: 'provider',
          estimatedCostUsd: null,
          errorCode: null,
          createdAt: comparisonItem.createdAt,
          completedAt: comparisonItem.createdAt,
        },
      ],
    };
    mockApi({
      ...signedIn,
      [`GET /api/comparisons/${comparisonItem.id}`]: () => jsonResponse(detail),
    });
    renderApp(`/history/comparisons/${comparisonItem.id}`);

    const column = await screen.findByRole('article');
    expect(within(column).getByText('Groq answered quickly.')).toBeInTheDocument();
    expect(within(column).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

function report(overrides: Partial<UsageReport> = {}): UsageReport {
  const days = Array.from({ length: 30 }, (_, index) => ({
    day: new Date(Date.UTC(2026, 7, 17 + index)).toISOString().slice(0, 10),
    runs: index === 29 ? 12 : index === 28 ? 4 : 0,
    failedRuns: index === 29 ? 2 : 0,
    inputTokens: index === 29 ? 1_000 : 0,
    outputTokens: index === 29 ? 400 : 0,
    estimatedCostUsd: index === 29 ? 0.004 : 0,
  }));
  const totals = {
    runs: 16,
    completedRuns: 13,
    failedRuns: 2,
    cancelledRuns: 1,
    inputTokens: 1_000,
    outputTokens: 400,
    providerCountedRuns: 10,
    estimatedCostUsd: 0.004,
    costedRuns: 8,
    averageLatencyMs: 1_240,
    p95LatencyMs: null,
    fallbackRuns: 1,
  };
  return {
    scope: 'personal',
    range: { from: '2026-08-17', to: '2026-09-15', days: 30 },
    totals,
    byModel: [{ ...totals, provider: 'groq', model: 'openai/gpt-oss-20b' }],
    byDay: days,
    activeUsers: null,
    ...overrides,
  };
}

describe('usage dashboard', () => {
  it('shows honest totals, a per-day chart with its table, and the model breakdown', async () => {
    const api = mockApi({ ...signedIn, 'GET /api/usage': () => jsonResponse(report()) });
    renderApp('/dashboard');

    // The Runs tile's value (the model table repeats the number in a cell).
    expect(await screen.findByText('16', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('2 failed · 1 stopped · 1 answered by a fallback')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText('Estimated for 6 of 16 runs')).toBeInTheDocument();
    expect(screen.getByText('Prices known for 8 of 16 runs')).toBeInTheDocument();
    expect(screen.getByText('Needs at least 20 completed runs')).toBeInTheDocument();

    const chart = screen.getByRole('img', { name: 'Runs per day: 16 runs over 30 days' });
    const lastDay = within(chart.closest('section') as HTMLElement).getByLabelText(
      'Sep 15: 12 runs, 2 failed',
    );
    fireEvent.focus(lastDay);
    expect(screen.getByRole('tooltip')).toHaveTextContent('12 runs');

    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getByRole('table', { name: 'Runs per day' })).toBeInTheDocument();
    expect(screen.getByText('groq/openai/gpt-oss-20b')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Scope' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() =>
      expect(
        requestedUrls(api).some(
          (url) => url.pathname === '/api/usage' && url.searchParams.get('days') === '7',
        ),
      ).toBe(true),
    );
  });

  it('lets admins switch to deployment totals', async () => {
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(adminMe),
      'GET /api/usage': () => jsonResponse(report()),
      'GET /api/admin/usage': () => jsonResponse(report({ scope: 'deployment', activeUsers: 5 })),
    });
    renderApp('/dashboard');

    fireEvent.click(await screen.findByRole('button', { name: 'Everyone' }));

    expect(await screen.findByText('5 active users')).toBeInTheDocument();
    expect(callsTo(api, 'GET /api/admin/usage')).toHaveLength(1);
  });
});
