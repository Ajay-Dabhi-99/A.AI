import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  baseRoutes,
  callsTo,
  errorResponse,
  jsonResponse,
  mockApi,
  renderApp,
  userMe,
} from './helpers/render';

const conversationId = '3f1b8e8a-2d7b-4b8f-9d2a-6f0c1e2b3a4d';
const token = 'Ab_-'.repeat(10) + 'xyz';

describe('sharing a chat (MODEL-070)', () => {
  it('creates, copies and stops a public link from the chat menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    let share: object | null = null;
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': () => jsonResponse({ models: [], providers: [], defaultModel: null }),
      'GET /api/conversations': () =>
        jsonResponse({
          conversations: [
            {
              id: conversationId,
              title: 'Trip ideas',
              pinnedAt: null,
              createdAt: '2026-09-14T09:00:00.000Z',
              updatedAt: '2026-09-14T09:05:00.000Z',
            },
          ],
        }),
      [`GET /api/conversations/${conversationId}/share`]: () => jsonResponse({ share }),
      [`POST /api/conversations/${conversationId}/share`]: () => {
        share = {
          token,
          messageCount: 4,
          createdAt: '2026-09-17T10:00:00.000Z',
          updatedAt: '2026-09-17T10:00:00.000Z',
        };
        return jsonResponse({ share });
      },
      [`DELETE /api/conversations/${conversationId}/share`]: () => {
        share = null;
        return new Response(null, { status: 204 });
      },
    });
    renderApp('/chat');
    const sidebar = await screen.findByRole('navigation', { name: 'Conversations' });
    await within(sidebar).findByRole('link', { name: 'Trip ideas' });
    fireEvent.keyDown(within(sidebar).getByRole('button', { name: 'Options for “Trip ideas”' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Share' }));

    const dialog = await screen.findByRole('dialog', { name: 'Share chat' });
    expect(await within(dialog).findByText('This chat is private.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

    const link = await within(dialog).findByRole('textbox', { name: 'Share link' });
    expect(link).toHaveValue(`${window.location.origin}/share/${token}`);
    expect(within(dialog).getByText(/4 messages · snapshot from/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/${token}`),
    );
    expect(within(dialog).getByRole('button', { name: 'Update link' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop sharing' }));
    expect(await within(dialog).findByText('This chat is private.')).toBeInTheDocument();
    expect(callsTo(api, `DELETE /api/conversations/${conversationId}/share`)).toHaveLength(1);
  });

  it('shows a shared chat read-only to anyone', async () => {
    mockApi({
      ...baseRoutes,
      [`GET /api/shared/${token}`]: () =>
        jsonResponse({
          title: 'Trip ideas',
          messages: [
            { role: 'user', content: 'Where should I go?', model: null },
            { role: 'assistant', content: 'Try **Jaipur**.', model: 'GPT-OSS 20B' },
          ],
          sharedAt: '2026-09-17T10:00:00.000Z',
          truncated: false,
        }),
    });
    renderApp(`/share/${token}`);

    expect(await screen.findByRole('heading', { name: 'Trip ideas' })).toBeInTheDocument();
    expect(screen.getByText('Shared chat · read-only')).toBeInTheDocument();
    expect(screen.getByText('Where should I go?')).toBeInTheDocument();
    expect(screen.getByText('Jaipur')).toBeInTheDocument();
    expect(screen.getByText('GPT-OSS 20B')).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start your own chat' })).toHaveAttribute(
      'href',
      '/chat',
    );
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });

  it('explains a link that was removed', async () => {
    mockApi({
      ...baseRoutes,
      [`GET /api/shared/${token}`]: () =>
        errorResponse(404, 'NOT_FOUND', 'This shared chat does not exist or was removed.'),
    });
    renderApp(`/share/${token}`);
    expect(
      await screen.findByText('This shared chat does not exist or was removed'),
    ).toBeInTheDocument();
  });
});
