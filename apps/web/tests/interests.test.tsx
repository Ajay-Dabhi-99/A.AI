import type { AuthUser, MeResponse } from '@a-ai/shared-types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  baseRoutes,
  callsTo,
  errorResponse,
  jsonResponse,
  mockApi,
  renderApp,
  testUser,
  userMe,
} from './helpers/render';

const meFor = (user: AuthUser): MeResponse => ({ ...userMe, identity: { kind: 'user', user } });

const newUser: AuthUser = { ...testUser, interests: [], interestsSetAt: null };

/** A signed-in account whose saved topics change when the API accepts them. */
function accountRoutes(initial: AuthUser) {
  let user = initial;
  return mockApi({
    ...baseRoutes,
    '/api/me': () => jsonResponse(meFor(user)),
    'GET /api/models': () => jsonResponse({ models: [], providers: [], defaultModel: null }),
    'GET /api/conversations': () => jsonResponse({ conversations: [] }),
    'PATCH /api/me/interests': (init) => {
      const { interests } = JSON.parse(String(init?.body)) as { interests: string[] };
      user = { ...user, interests, interestsSetAt: '2026-09-17T10:00:00.000Z' };
      return jsonResponse({ user });
    },
  });
}

describe('topics after signing in', () => {
  it('asks once, allows up to three topics including your own, and saves them', async () => {
    const api = accountRoutes(newUser);
    renderApp('/chat');

    const dialog = await screen.findByRole('dialog', { name: 'What are you interested in?' });
    const save = within(dialog).getByRole('button', { name: 'Save topics' });
    expect(save).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Travel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Coding' }));
    const custom = within(dialog).getByLabelText('Add your own topic');
    fireEvent.change(custom, { target: { value: '  Street   food ' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    expect(within(dialog).getByText('3 of 3 selected')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Street food' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Full: other topics and the custom field are locked until one is removed.
    expect(within(dialog).getByRole('button', { name: 'Finance' })).toBeDisabled();
    expect(within(dialog).getByLabelText('Add your own topic')).toBeDisabled();

    fireEvent.click(save);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'What are you interested in?' })).toBeNull(),
    );
    expect(JSON.parse(String(callsTo(api, 'PATCH /api/me/interests')[0]?.body))).toEqual({
      interests: ['Travel', 'Coding', 'Street food'],
    });
  });

  it('refuses a duplicate or odd custom topic with a message', async () => {
    accountRoutes(newUser);
    renderApp('/chat');
    const dialog = await screen.findByRole('dialog', { name: 'What are you interested in?' });
    const custom = within(dialog).getByLabelText('Add your own topic');

    fireEvent.change(custom, { target: { value: 'travel' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Travel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('You already picked that topic.');

    fireEvent.change(custom, { target: { value: '<b>' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Use letters, numbers and simple punctuation.',
    );
  });

  it('records a skip so the question is not asked again', async () => {
    const api = accountRoutes(newUser);
    renderApp('/chat');
    const dialog = await screen.findByRole('dialog', { name: 'What are you interested in?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Skip for now' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(String(callsTo(api, 'PATCH /api/me/interests')[0]?.body))).toEqual({
      interests: [],
    });
  });

  it('keeps the dialog open with the error when saving fails', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(meFor(newUser)),
      'GET /api/models': () => jsonResponse({ models: [], providers: [], defaultModel: null }),
      'GET /api/conversations': () => jsonResponse({ conversations: [] }),
      'PATCH /api/me/interests': () =>
        errorResponse(400, 'VALIDATION_ERROR', 'Pick at most 3 topics'),
    });
    renderApp('/chat');
    const dialog = await screen.findByRole('dialog', { name: 'What are you interested in?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Design' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save topics' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Pick at most 3 topics');
  });

  it('is not shown to people who already answered, or to guests', async () => {
    accountRoutes(testUser);
    const { unmount } = renderApp('/chat');
    await screen.findByLabelText('Message');
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
  });
});

describe('topic-based starters and the profile card', () => {
  it('suggests prompts for the chosen topics in a new chat', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(meFor({ ...testUser, interests: ['Travel', 'Pottery'] })),
      'GET /api/models': () =>
        jsonResponse({
          models: [
            {
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
            },
          ],
          providers: [{ id: 'groq', name: 'Groq', configured: true }],
          defaultModel: { provider: 'groq', id: 'openai/gpt-oss-20b' },
        }),
      'GET /api/conversations': () => jsonResponse({ conversations: [] }),
    });
    renderApp('/chat');

    expect(
      await screen.findByText(/Suggested for your topics: Travel · Pottery/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Plan a three-day trip to Jaipur on a moderate budget.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Explain the basics of Pottery for a beginner.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'What should I pack for a week of hiking in the mountains?',
      }),
    ).toBeInTheDocument();
  });

  it('changes the saved topics from the profile page', async () => {
    const api = accountRoutes({ ...testUser, interests: ['Travel'] });
    renderApp('/settings');
    const card = await screen.findByRole('region', { name: 'Your topics' });
    const save = within(card).getByRole('button', { name: 'Save topics' });
    expect(within(card).getByRole('button', { name: 'Travel' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(save).toBeDisabled();

    fireEvent.click(within(card).getByRole('button', { name: 'Travel' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Science' }));
    fireEvent.click(save);

    await waitFor(() =>
      expect(JSON.parse(String(callsTo(api, 'PATCH /api/me/interests')[0]?.body))).toEqual({
        interests: ['Science'],
      }),
    );
    expect(
      await within(await screen.findByRole('region', { name: 'Your topics' })).findByRole(
        'button',
        { name: 'Science' },
      ),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
