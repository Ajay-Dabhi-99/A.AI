import type { AIModel, ChatMessage } from '@a-ai/shared-types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useModelStore } from '../src/stores/model-store';
import {
  baseRoutes,
  callsTo,
  errorResponse,
  guestMe,
  jsonResponse,
  mockApi,
  renderApp,
  userMe,
} from './helpers/render';

const models: AIModel[] = [
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
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    name: 'Gemini 3.8 Flash',
    category: 'text',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    availability: 'free-tier',
  },
];

// The model store lives in memory for the whole file; start each test with no remembered choice.
beforeEach(() => {
  useModelStore.setState({ selected: null });
});

const modelsRoute = () =>
  jsonResponse({ models, defaultModel: { provider: 'groq', id: 'openai/gpt-oss-20b' } });

type StreamEvent = [name: string, data: object];

const START: StreamEvent = [
  'message.start',
  { runId: 'r1', provider: 'groq', model: 'openai/gpt-oss-20b', conversationId: null },
];
const DONE: StreamEvent = [
  'message.done',
  { runId: 'r1', status: 'completed', messageId: null, latencyMs: 1200 },
];

/** A text/event-stream response. With `hang`, it stays open until the request is aborted. */
function sse(
  events: StreamEvent[],
  init?: RequestInit,
  options: { hang?: boolean } = {},
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [name, data] of events) {
        controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
      }
      if (!options.hang) {
        controller.close();
        return;
      }
      init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), {
        once: true,
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function guestRoutes(extra: Record<string, (init: RequestInit | undefined) => Response> = {}) {
  return {
    ...baseRoutes,
    'GET /api/models': modelsRoute,
    'GET /api/guest/conversation': () =>
      jsonResponse({ messages: [], expiresAt: '2026-09-15T10:00:00.000Z' }),
    ...extra,
  };
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

describe('chat page as a guest', () => {
  it('streams an answer, renders Markdown and shows the daily allowance', async () => {
    const api = mockApi(
      guestRoutes({
        'POST /api/chat': (init) =>
          sse(
            [
              START,
              ['message.delta', { runId: 'r1', text: 'Vectors are **fast**' }],
              ['message.delta', { runId: 'r1', text: ' to search.' }],
              DONE,
            ],
            init,
          ),
      }),
    );
    renderApp('/chat');

    expect(
      await screen.findByRole('heading', { name: 'What would you like to ask?' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/20 of 20 messages left today/)).toBeInTheDocument();

    typeAndSend('What is a vector database?');

    expect(await screen.findByText('fast', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('What is a vector database?')).toBeInTheDocument();
    expect(await screen.findByText('GPT-OSS 20B · 1.2s')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('');

    const [request] = callsTo(api, 'POST /api/chat');
    expect(JSON.parse(String(request?.body))).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      message: 'What is a vector database?',
    });
  });

  it('remembers the chosen model and sends the next message with it', async () => {
    const api = mockApi(guestRoutes({ 'POST /api/chat': (init) => sse([START, DONE], init) }));
    renderApp('/chat');

    const picker = await screen.findByLabelText('Model');
    expect(within(picker).getByRole('group', { name: 'Gemini' })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'gemini::gemini-3.8-flash' } });
    expect(localStorage.getItem('a-ai-model')).toBe(
      '{"provider":"gemini","id":"gemini-3.8-flash"}',
    );

    typeAndSend('hello');
    await waitFor(() => expect(callsTo(api, 'POST /api/chat')).toHaveLength(1));
    expect(JSON.parse(String(callsTo(api, 'POST /api/chat')[0]?.body))).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
    });
  });

  it('restores the draft and offers sign-up when the daily limit is reached', async () => {
    mockApi(
      guestRoutes({
        'POST /api/chat': () =>
          errorResponse(429, 'QUOTA_EXCEEDED', 'You have used all 20 messages for today.'),
      }),
    );
    renderApp('/chat');
    await screen.findByLabelText('Message');

    typeAndSend('one more question');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You have used all 20 messages for today.',
    );
    expect(screen.getByRole('link', { name: /create a free account/i })).toHaveAttribute(
      'href',
      '/signup',
    );
    expect(screen.getByLabelText('Message')).toHaveValue('one more question');
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByText('one more question', { selector: 'div' })).not.toBeInTheDocument();
  });

  it('shows a failure during the answer and retries without repeating the question', async () => {
    let attempt = 0;
    const api = mockApi(
      guestRoutes({
        'POST /api/chat': (init) => {
          attempt += 1;
          return attempt === 1
            ? sse(
                [
                  START,
                  [
                    'error',
                    {
                      runId: 'r1',
                      code: 'PROVIDER_TIMEOUT',
                      message: 'Groq did not respond in time.',
                      retryable: true,
                    },
                  ],
                ],
                init,
              )
            : sse([START, ['message.delta', { runId: 'r1', text: 'Here you go.' }], DONE], init);
        },
      }),
    );
    renderApp('/chat');
    await screen.findByLabelText('Message');

    typeAndSend('Are you there?');
    expect(await screen.findByRole('alert')).toHaveTextContent('Groq did not respond in time.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Here you go.')).toBeInTheDocument();

    expect(JSON.parse(String(callsTo(api, 'POST /api/chat')[1]?.body))).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      retry: true,
    });
    expect(screen.getAllByText('Are you there?')).toHaveLength(1);
  });

  it('stops a streaming answer and keeps what arrived', async () => {
    mockApi(
      guestRoutes({
        'POST /api/chat': (init) =>
          sse([START, ['message.delta', { runId: 'r1', text: 'Partial answer' }]], init, {
            hang: true,
          }),
      }),
    );
    renderApp('/chat');
    await screen.findByLabelText('Message');

    typeAndSend('Tell me a long story');
    expect(await screen.findByText('Partial answer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));

    expect(await screen.findByRole('button', { name: 'Send message' })).toBeInTheDocument();
    expect(screen.getByText('Partial answer')).toBeInTheDocument();
    expect(screen.getByText(/stopped/)).toBeInTheDocument();
  });

  it('neutralises unsafe Markdown from the model', async () => {
    const hostile: ChatMessage = {
      id: 'm2',
      role: 'assistant',
      content:
        'Click [here](javascript:alert(1)) <script>alert(2)</script> <img src=x onerror=alert(3)>',
      createdAt: '2026-09-14T10:00:01.000Z',
    };
    mockApi(
      guestRoutes({
        'GET /api/guest/conversation': () =>
          jsonResponse({
            messages: [
              { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-09-14T10:00:00.000Z' },
              hostile,
            ],
            expiresAt: '2026-09-15T10:00:00.000Z',
          }),
      }),
    );
    const { container } = renderApp('/chat');

    // The javascript: URL is stripped, so "here" is not a working link at all.
    expect(await screen.findByText('here')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'here' })).not.toBeInTheDocument();
    const markdown = container.querySelectorAll('.markdown');
    for (const element of markdown) {
      expect(element.innerHTML).not.toMatch(/javascript:/i);
    }
    expect(container.querySelector('.markdown script, .markdown img')).toBeNull();
  });

  it('explains when no model is configured and disables sending', async () => {
    mockApi(
      guestRoutes({ 'GET /api/models': () => jsonResponse({ models: [], defaultModel: null }) }),
    );
    renderApp('/chat');

    expect(await screen.findByText('No AI model is available yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });

  it('sends guests who open a saved conversation link to sign in', async () => {
    mockApi(guestRoutes());
    const { router } = renderApp('/chat/3f1b8e8a-2d7b-4b8f-9d2a-6f0c1e2b3a4d');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});

describe('chat page for a signed-in user', () => {
  const conversationId = '3f1b8e8a-2d7b-4b8f-9d2a-6f0c1e2b3a4d';

  it('opens a saved conversation, lists chats and continues it', async () => {
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': modelsRoute,
      'GET /api/conversations': () =>
        jsonResponse({
          conversations: [
            {
              id: conversationId,
              title: 'Vector databases',
              createdAt: '2026-09-14T09:00:00.000Z',
              updatedAt: '2026-09-14T09:05:00.000Z',
            },
          ],
        }),
      [`GET /api/conversations/${conversationId}`]: () =>
        jsonResponse({
          id: conversationId,
          title: 'Vector databases',
          createdAt: '2026-09-14T09:00:00.000Z',
          updatedAt: '2026-09-14T09:05:00.000Z',
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: 'What is a vector database?',
              createdAt: '2026-09-14T09:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: 'A database for embeddings.',
              createdAt: '2026-09-14T09:00:02.000Z',
              run: {
                provider: 'groq',
                model: 'openai/gpt-oss-20b',
                status: 'completed',
                latencyMs: 900,
              },
            },
          ],
        }),
      'POST /api/chat': (init) =>
        sse(
          [
            [
              'message.start',
              { runId: 'r2', provider: 'groq', model: 'openai/gpt-oss-20b', conversationId },
            ],
            ['message.delta', { runId: 'r2', text: 'Sure.' }],
            DONE,
          ],
          init,
        ),
    });
    renderApp(`/chat/${conversationId}`);

    expect(await screen.findByText('A database for embeddings.')).toBeInTheDocument();
    expect(screen.getByText('GPT-OSS 20B · 0.9s')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Vector databases' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText(/197 of 200 messages left today/)).toBeInTheDocument();

    typeAndSend('Give an example');
    expect(await screen.findByText('Sure.')).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(api, 'POST /api/chat')[0]?.body))).toMatchObject({
      conversationId,
      message: 'Give an example',
    });
  });

  it('explains a conversation that does not exist', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': modelsRoute,
      'GET /api/conversations': () => jsonResponse({ conversations: [] }),
      [`GET /api/conversations/${conversationId}`]: () =>
        errorResponse(404, 'NOT_FOUND', 'This conversation does not exist.'),
    });
    renderApp(`/chat/${conversationId}`);
    expect(await screen.findByText('This conversation does not exist')).toBeInTheDocument();
  });
});

describe('guest identity helper', () => {
  it('keeps the guest fixture consistent with the chat page', () => {
    expect(guestMe.identity.kind).toBe('guest');
  });
});
