import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  baseRoutes,
  callsTo,
  errorResponse,
  jsonResponse,
  mockApi,
  renderApp,
  userMe,
} from './helpers/render';

const chat = (id: string, title: string) => ({
  id,
  title,
  pinnedAt: null,
  createdAt: '2026-09-14T09:00:00.000Z',
  updatedAt: '2026-09-14T09:05:00.000Z',
});

function routes(search: (q: string) => Response) {
  return mockApi({
    ...baseRoutes,
    '/api/me': () => jsonResponse(userMe),
    'GET /api/models': () => jsonResponse({ models: [], providers: [], defaultModel: null }),
    'GET /api/conversations': () =>
      jsonResponse({
        conversations: [
          chat('11111111-1111-4111-8111-111111111111', 'Budget'),
          chat('22222222-2222-4222-8222-222222222222', 'Kyoto trip'),
        ],
      }),
    'GET /api/conversations/search': () => search(''),
  });
}

describe('searching chats (MODEL-071)', () => {
  it('searches message text on the server and highlights the match', async () => {
    const api = routes(() =>
      jsonResponse({
        results: [
          {
            ...chat('11111111-1111-4111-8111-111111111111', 'Budget'),
            matchedIn: 'message',
            snippet: '…my rent is 50% of pay…',
          },
        ],
      }),
    );
    renderApp('/chat');
    const sidebar = await screen.findByRole('navigation', { name: 'Conversations' });
    await within(sidebar).findByRole('link', { name: 'Kyoto trip' });

    const box = within(sidebar).getByPlaceholderText('Search chats and messages');
    fireEvent.change(box, { target: { value: 'r' } });
    expect(within(sidebar).getByText(/Type at least 2 characters/)).toBeInTheDocument();

    fireEvent.change(box, { target: { value: '  Rent  ' } });
    const results = await within(sidebar).findByRole('region', { name: 'Search results' });
    expect(within(results).getByText('1 chat')).toBeInTheDocument();
    const link = within(results).getByRole('link');
    expect(link).toHaveAttribute('href', '/chat/11111111-1111-4111-8111-111111111111');
    expect(within(link).getByText('rent', { selector: 'mark' })).toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Kyoto trip' })).toBeNull();

    const url = String(api.mock.calls.find(([input]) => String(input).includes('/search'))![0]);
    expect(url).toContain('q=Rent');
    expect(callsTo(api, 'GET /api/conversations/search')).toHaveLength(1);

    fireEvent.change(box, { target: { value: '' } });
    expect(await within(sidebar).findByRole('link', { name: 'Kyoto trip' })).toBeInTheDocument();
  });

  it('says when nothing matches or search fails', async () => {
    let fail = false;
    routes(() =>
      fail
        ? errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong.')
        : jsonResponse({ results: [] }),
    );
    renderApp('/chat');
    const sidebar = await screen.findByRole('navigation', { name: 'Conversations' });
    const box = await within(sidebar).findByPlaceholderText('Search chats and messages');

    fireEvent.change(box, { target: { value: 'zebra' } });
    expect(await within(sidebar).findByText('No chats mention “zebra”.')).toBeInTheDocument();

    fail = true;
    fireEvent.change(box, { target: { value: 'giraffe' } });
    await waitFor(() =>
      expect(within(sidebar).getByRole('alert')).toHaveTextContent(
        'Search is not available right now.',
      ),
    );
  });
});
