import type { AIModel, ChatMessage } from '@a-ai/shared-types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    inputPricePerMillionUsd: null,
    outputPricePerMillionUsd: null,
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
    inputPricePerMillionUsd: null,
    outputPricePerMillionUsd: null,
  },
];

// The model store lives in memory for the whole file; start each test with no remembered choice.
beforeEach(() => {
  useModelStore.setState({ selected: null });
});

const providers = [
  { id: 'groq', name: 'Groq', configured: true },
  { id: 'gemini', name: 'Gemini', configured: true },
];

const modelsRoute = () =>
  jsonResponse({ models, providers, defaultModel: { provider: 'groq', id: 'openai/gpt-oss-20b' } });

type StreamEvent = [name: string, data: object];

const CONTEXT = {
  inputTokens: 1_300,
  budgetTokens: 120_000,
  contextWindow: 131_072,
  droppedMessages: 0,
  summaryIncluded: false,
};

const START: StreamEvent = [
  'message.start',
  {
    runId: 'r1',
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    conversationId: null,
    context: CONTEXT,
  },
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

/** Matches a paragraph by its whole text; streaming answers wrap each word in its own span. */
const paragraphText = (text: string) => (_: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === text;

describe('copy, regenerate and edit (MODEL-068)', () => {
  /** A guest chat whose answers come from `answers` in order; each request body is recorded. */
  function answering(answers: (string | Response)[]) {
    let turn = 0;
    return mockApi(
      guestRoutes({
        'POST /api/chat': (init) => {
          const next = answers[turn++];
          if (next instanceof Response) return next;
          return sse([START, ['message.delta', { runId: 'r1', text: next ?? '' }], DONE], init);
        },
      }),
    );
  }

  it('copies an answer and a code block', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    answering(['Use this:\n\n```js\nconsole.log(1);\n```']);
    renderApp('/chat');
    await screen.findByLabelText('Message');
    typeAndSend('Show code');
    // The answer's own Copy button appears once it has finished typing.
    await screen.findByRole('button', { name: 'Regenerate' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('console.log(1);\n'));

    const answer = screen.getAllByRole('button', { name: 'Copy' }).at(-1)!;
    fireEvent.click(answer);
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith('Use this:\n\n```js\nconsole.log(1);\n```'),
    );
    expect(await screen.findAllByRole('button', { name: 'Copied' })).not.toHaveLength(0);
  });

  it('regenerates the latest answer in place', async () => {
    const api = answering(['First answer.', 'Second answer.']);
    renderApp('/chat');
    await screen.findByLabelText('Message');
    typeAndSend('Tell me something');
    await screen.findByText(paragraphText('First answer.'));

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(await screen.findByText('Second answer.')).toBeInTheDocument();
    expect(screen.queryByText('First answer.')).not.toBeInTheDocument();
    expect(JSON.parse(String(callsTo(api, 'POST /api/chat')[1]?.body))).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      regenerate: true,
    });
    expect(screen.getAllByText('Tell me something')).toHaveLength(1);
  });

  it('puts the answer back when a regenerate is refused', async () => {
    answering([
      'Keep me.',
      errorResponse(429, 'QUOTA_EXCEEDED', 'You have used all 20 messages for today.'),
    ]);
    renderApp('/chat');
    await screen.findByLabelText('Message');
    typeAndSend('Question');
    await screen.findByText(paragraphText('Keep me.'));

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(await screen.findByText('You have used all 20 messages for today.')).toBeInTheDocument();
    expect(screen.getByText('Keep me.')).toBeInTheDocument();
  });

  it('edits only the latest question and answers it again', async () => {
    const api = answering(['Paris.', 'Berlin.', 'Rome.']);
    renderApp('/chat');
    await screen.findByLabelText('Message');
    typeAndSend('Capital of France?');
    await screen.findByText(paragraphText('Paris.'));
    typeAndSend('Capital of Germany?');
    await screen.findByText(paragraphText('Berlin.'));

    // Only the latest question can be edited.
    expect(screen.getAllByRole('button', { name: 'Edit message' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    const field = screen.getByRole('textbox', { name: 'Edit your message' });
    expect(field).toHaveValue('Capital of Germany?');

    // Escape leaves it unchanged.
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Edit your message' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit your message' }), {
      target: { value: 'Capital of Italy?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save & send' }));

    expect(await screen.findByText('Rome.')).toBeInTheDocument();
    expect(screen.queryByText('Berlin.')).not.toBeInTheDocument();
    expect(screen.queryByText('Capital of Germany?')).not.toBeInTheDocument();
    expect(screen.getByText('Capital of Italy?')).toBeInTheDocument();
    expect(screen.getByText('Paris.')).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(api, 'POST /api/chat')[2]?.body))).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      edit: true,
      message: 'Capital of Italy?',
    });
  });
});

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
    // The composer shows how much of the model's context the request used.
    expect(screen.getByText(/Context 1\.3k of 120k tokens \(1%\)/)).toBeInTheDocument();

    const [request] = callsTo(api, 'POST /api/chat');
    expect(JSON.parse(String(request?.body))).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      message: 'What is a vector database?',
    });
  });

  it('suggests follow-up questions under the latest answer and sends one when clicked', async () => {
    let chats = 0;
    const api = mockApi(
      guestRoutes({
        'POST /api/chat': (init) => {
          chats += 1;
          const text = chats === 1 ? 'A database for embeddings.' : 'Pinecone and Qdrant.';
          return sse([START, ['message.delta', { runId: 'r1', text }], DONE], init);
        },
        'POST /api/chat/suggestions': (init) => {
          const { question } = JSON.parse(String(init?.body)) as { question: string };
          return jsonResponse({
            suggestions:
              question === 'What is a vector database?'
                ? ['Which ones are popular?', 'How are they indexed?']
                : [],
          });
        },
      }),
    );
    renderApp('/chat');
    await screen.findByLabelText('Message');

    typeAndSend('What is a vector database?');
    const followUps = await screen.findByRole('navigation', { name: 'Suggested follow-ups' });
    expect(JSON.parse(String(callsTo(api, 'POST /api/chat/suggestions')[0]?.body))).toEqual({
      question: 'What is a vector database?',
      answer: 'A database for embeddings.',
    });
    fireEvent.click(within(followUps).getByRole('button', { name: 'Which ones are popular?' }));

    expect(await screen.findByText('Pinecone and Qdrant.')).toBeInTheDocument();
    expect(JSON.parse(String(callsTo(api, 'POST /api/chat')[1]?.body))).toMatchObject({
      message: 'Which ones are popular?',
    });
    // Only the latest answer offers follow-ups, and an empty list shows nothing.
    await waitFor(() => expect(callsTo(api, 'POST /api/chat/suggestions')).toHaveLength(2));
    expect(screen.queryByRole('navigation', { name: 'Suggested follow-ups' })).toBeNull();
  });

  it('labels a reply that another model answered', async () => {
    mockApi(
      guestRoutes({
        'POST /api/chat': (init) =>
          sse(
            [
              START,
              [
                'message.retry',
                { runId: 'r1', attempt: 2, delayMs: 500, code: 'PROVIDER_TIMEOUT' },
              ],
              [
                'message.fallback',
                {
                  runId: 'r1',
                  from: { provider: 'groq', model: 'openai/gpt-oss-20b' },
                  to: { provider: 'gemini', model: 'gemini-3.8-flash' },
                  code: 'PROVIDER_TIMEOUT',
                  reason: 'Groq did not respond',
                },
              ],
              ['message.delta', { runId: 'r1', text: 'Gemini here.' }],
              DONE,
            ],
            init,
          ),
      }),
    );
    renderApp('/chat');
    await screen.findByRole('heading', { name: 'What would you like to ask?' });

    typeAndSend('Hello?');

    expect(await screen.findByText('Gemini here.')).toBeInTheDocument();
    expect(
      screen.getByText('Answered by Gemini 3.8 Flash because GPT-OSS 20B was unavailable.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Gemini 3.8 Flash · 1.2s')).toBeInTheDocument();
  });

  it('remembers the chosen model and sends the next message with it', async () => {
    const api = mockApi(guestRoutes({ 'POST /api/chat': (init) => sse([START, DONE], init) }));
    renderApp('/chat');

    // The shadcn/ui Select opens from the keyboard and lists models grouped by provider.
    const picker = await screen.findByRole('combobox', { name: 'Model' });
    fireEvent.keyDown(picker, { key: 'Enter' });
    const gemini = await screen.findByRole('group', { name: 'Gemini' });
    fireEvent.click(within(gemini).getByRole('option', { name: 'Gemini 3.8 Flash' }));
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

  it('jumps to the newest message when sending after scrolling up', async () => {
    mockApi(
      guestRoutes({
        'POST /api/chat': (init) =>
          sse([START, ['message.delta', { runId: 'r1', text: 'Hi' }]], init, { hang: true }),
      }),
    );
    const { container } = renderApp('/chat');
    await screen.findByLabelText('Message');

    const list = container.querySelector<HTMLElement>('[aria-live="polite"]');
    if (!list) throw new Error('chat list not found');
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 5_000 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 500 });
    list.scrollTop = 1_000;
    fireEvent.scroll(list);

    typeAndSend('A follow-up question');

    await waitFor(() => expect(list.scrollTop).toBe(5_000));
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
    expect(await screen.findByText(paragraphText('Partial answer'))).toBeInTheDocument();

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
      guestRoutes({
        'GET /api/models': () => jsonResponse({ models: [], defaultModel: null, providers: [] }),
      }),
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
              pinnedAt: null,
              createdAt: '2026-09-14T09:00:00.000Z',
              updatedAt: '2026-09-14T09:05:00.000Z',
            },
          ],
        }),
      [`GET /api/conversations/${conversationId}`]: () =>
        jsonResponse({
          id: conversationId,
          title: 'Vector databases',
          pinnedAt: null,
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

  /** Opens a chat's ⋯ menu from the keyboard and picks an item. */
  async function chooseFromMenu(sidebar: HTMLElement, title: string, item: string) {
    fireEvent.keyDown(within(sidebar).getByRole('button', { name: `Options for “${title}”` }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: item }));
  }

  const summary = (id: string, title: string, pinnedAt: string | null = null) => ({
    id,
    title,
    pinnedAt,
    createdAt: '2026-09-14T09:00:00.000Z',
    updatedAt: '2026-09-14T09:05:00.000Z',
  });

  const imageStatus = () =>
    jsonResponse({
      enabled: true,
      models: [
        {
          provider: 'cloudflare',
          model: '@cf/black-forest-labs/flux-1-schnell',
          name: 'FLUX.1 [schnell]',
        },
      ],
    });

  const imageJob = (overrides: Record<string, unknown> = {}) => ({
    id: '7c1b8e8a-2d7b-4b8f-9d2a-6f0c1e2b3a4d',
    kind: 'image',
    status: 'queued',
    provider: 'cloudflare',
    model: '@cf/black-forest-labs/flux-1-schnell',
    prompt: 'A paper boat at sunrise',
    progress: null,
    errorCode: null,
    attachment: null,
    conversationId,
    createdAt: '2026-09-14T09:10:00.000Z',
    completedAt: null,
    ...overrides,
  });

  it('creates an image inside a new chat and shows it when it is ready', async () => {
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': modelsRoute,
      'GET /api/conversations': () => jsonResponse({ conversations: [] }),
      'GET /api/image/status': imageStatus,
      'POST /api/image/generate': () => jsonResponse({ job: imageJob() }, 202),
      [`GET /api/jobs/${imageJob().id}/events`]: (init) =>
        sse(
          [
            ['job', imageJob({ status: 'processing', progress: 0.1 })],
            ['job', imageJob({ status: 'failed', errorCode: 'RATE_LIMITED' })],
          ],
          init,
        ),
    });
    const { router } = renderApp('/chat');
    await screen.findByLabelText('Message');

    const toggle = await screen.findByRole('button', { name: 'Image' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('FLUX.1 [schnell]')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create image' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: '  A paper boat at sunrise  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create image' }));

    await waitFor(() => expect(callsTo(api, 'POST /api/image/generate')).toHaveLength(1));
    expect(JSON.parse(String(callsTo(api, 'POST /api/image/generate')[0]?.body))).toEqual({
      provider: 'cloudflare',
      model: '@cf/black-forest-labs/flux-1-schnell',
      prompt: 'A paper boat at sunrise',
      conversationId: 'new',
    });
    expect(await screen.findByText('Create image')).toBeInTheDocument();
    expect(screen.getByText('A paper boat at sunrise')).toBeInTheDocument();
    expect(
      await screen.findByText('The free image allowance is used up for now. Try again later.'),
    ).toBeInTheDocument();
    expect(callsTo(api, 'POST /api/chat')).toHaveLength(0);
    await waitFor(() => expect(window.location.pathname).toBe(`/chat/${conversationId}`));
    expect(router.state.location.pathname).toBe('/chat');
  });

  it('shows the images a saved chat created, in order with its messages', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': modelsRoute,
      'GET /api/conversations': () => jsonResponse({ conversations: [] }),
      'GET /api/image/status': imageStatus,
      [`GET /api/conversations/${conversationId}`]: () =>
        jsonResponse({
          id: conversationId,
          title: 'Boats',
          pinnedAt: null,
          createdAt: '2026-09-14T09:00:00.000Z',
          updatedAt: '2026-09-14T09:20:00.000Z',
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: 'Name a famous boat',
              createdAt: '2026-09-14T09:00:00.000Z',
            },
            {
              id: 'm2',
              role: 'assistant',
              content: 'The Titanic.',
              createdAt: '2026-09-14T09:00:02.000Z',
            },
            {
              id: 'm3',
              role: 'user',
              content: 'And a small one?',
              createdAt: '2026-09-14T09:20:00.000Z',
            },
          ],
          mediaJobs: [imageJob({ status: 'cancelled', completedAt: '2026-09-14T09:11:00.000Z' })],
        }),
    });
    renderApp(`/chat/${conversationId}`);

    expect(await screen.findByText('Image creation was cancelled.')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    const order = [
      'Name a famous boat',
      'The Titanic.',
      'A paper boat at sunrise',
      'Image creation was cancelled.',
      'And a small one?',
    ];
    const positions = order.map((text) => items.findIndex((item) => item.includes(text)));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('offers no image button to guests', async () => {
    const api = mockApi(guestRoutes({ 'GET /api/image/status': imageStatus }));
    renderApp('/chat');
    await screen.findByLabelText('Message');
    await waitFor(() => expect(callsTo(api, 'GET /api/image/status').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Image' })).not.toBeInTheDocument();
  });

  it('pins and renames chats from the options menu', async () => {
    const tripId = '5a1b8e8a-2d7b-4b8f-9d2a-6f0c1e2b3a4d';
    let chats = [
      summary(conversationId, 'Vector databases'),
      { ...summary(tripId, 'Trip ideas'), updatedAt: '2026-09-13T09:05:00.000Z' },
    ];
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': modelsRoute,
      'GET /api/conversations': () =>
        jsonResponse({
          conversations: [...chats].sort(
            (a, b) =>
              (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '') ||
              b.updatedAt.localeCompare(a.updatedAt),
          ),
        }),
      [`PATCH /api/conversations/${tripId}`]: (init) => {
        const body = JSON.parse(String(init?.body)) as { title?: string; pinned?: boolean };
        chats = chats.map((chat) =>
          chat.id === tripId
            ? {
                ...chat,
                ...(body.title === undefined ? {} : { title: body.title }),
                ...(body.pinned === undefined
                  ? {}
                  : { pinnedAt: body.pinned ? '2026-09-15T10:00:00.000Z' : null }),
              }
            : chat,
        );
        return jsonResponse({ conversation: chats.find((chat) => chat.id === tripId) });
      },
    });
    const patches = () => callsTo(api, `PATCH /api/conversations/${tripId}`);
    renderApp('/chat');
    const sidebar = await screen.findByRole('navigation', { name: 'Conversations' });
    await within(sidebar).findByRole('link', { name: 'Trip ideas' });
    expect(within(sidebar).queryByRole('region', { name: 'Pinned' })).not.toBeInTheDocument();

    // The menu offers the three actions.
    fireEvent.keyDown(within(sidebar).getByRole('button', { name: 'Options for “Trip ideas”' }), {
      key: 'Enter',
    });
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Rename', 'Pin to top', 'Delete']);
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    await chooseFromMenu(sidebar, 'Trip ideas', 'Pin to top');
    const pinned = await within(sidebar).findByRole('region', { name: 'Pinned' });
    expect(within(pinned).getByRole('link', { name: 'Trip ideas' })).toBeInTheDocument();
    await waitFor(() => expect(patches()[0]?.body).toBe(JSON.stringify({ pinned: true })));

    await chooseFromMenu(sidebar, 'Trip ideas', 'Rename');
    const field = await within(sidebar).findByRole('textbox', { name: 'Chat title' });
    expect(field).toHaveValue('Trip ideas');

    // A blank title is refused with a message and nothing is sent.
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.submit(field);
    expect(within(sidebar).getByRole('alert')).toHaveTextContent('Enter a title');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(patches()).toHaveLength(1);

    fireEvent.change(field, { target: { value: '  Kyoto in autumn  ' } });
    expect(within(sidebar).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.submit(field);
    expect(
      await within(pinned).findByRole('link', { name: 'Kyoto in autumn' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(patches()[1]?.body).toBe(JSON.stringify({ title: 'Kyoto in autumn' })),
    );

    // Escape abandons an edit, and an unchanged title sends nothing.
    await chooseFromMenu(sidebar, 'Kyoto in autumn', 'Rename');
    const again = await within(sidebar).findByRole('textbox', { name: 'Chat title' });
    fireEvent.change(again, { target: { value: 'Discard me' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(within(sidebar).queryByRole('textbox', { name: 'Chat title' })).not.toBeInTheDocument();
    await chooseFromMenu(sidebar, 'Kyoto in autumn', 'Rename');
    fireEvent.submit(await within(sidebar).findByRole('textbox', { name: 'Chat title' }));
    expect(patches()).toHaveLength(2);

    await chooseFromMenu(sidebar, 'Kyoto in autumn', 'Unpin');
    await waitFor(() =>
      expect(within(sidebar).queryByRole('region', { name: 'Pinned' })).not.toBeInTheDocument(),
    );
    expect(patches()[2]?.body).toBe(JSON.stringify({ pinned: false }));
  });

  it('deletes a chat after confirming in a dialog', async () => {
    const tripId = '5a1b8e8a-2d7b-4b8f-9d2a-6f0c1e2b3a4d';
    let chats = [summary(conversationId, 'Vector databases'), summary(tripId, 'Trip ideas')];
    const removeRoute = (id: string) => () => {
      chats = chats.filter((chat) => chat.id !== id);
      return new Response(null, { status: 204 });
    };
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': modelsRoute,
      'GET /api/conversations': () => jsonResponse({ conversations: chats }),
      [`GET /api/conversations/${conversationId}`]: () =>
        jsonResponse({ ...summary(conversationId, 'Vector databases'), messages: [] }),
      [`DELETE /api/conversations/${tripId}`]: removeRoute(tripId),
      [`DELETE /api/conversations/${conversationId}`]: removeRoute(conversationId),
    });
    const { router } = renderApp(`/chat/${conversationId}`);
    const sidebar = await screen.findByRole('navigation', { name: 'Conversations' });
    await within(sidebar).findByRole('link', { name: 'Trip ideas' });

    // Cancel keeps the chat and sends nothing.
    await chooseFromMenu(sidebar, 'Trip ideas', 'Delete');
    let dialog = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    expect(dialog).toHaveTextContent('“Trip ideas” and all its messages will be deleted');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(sidebar).getByRole('link', { name: 'Trip ideas' })).toBeInTheDocument();
    expect(callsTo(api, `DELETE /api/conversations/${tripId}`)).toHaveLength(0);

    await chooseFromMenu(sidebar, 'Trip ideas', 'Delete');
    dialog = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete chat' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(sidebar).queryByRole('link', { name: 'Trip ideas' })).not.toBeInTheDocument();
    expect(callsTo(api, `DELETE /api/conversations/${tripId}`)).toHaveLength(1);
    expect(router.state.location.pathname).toBe(`/chat/${conversationId}`);

    // Deleting the open chat starts a new one.
    await chooseFromMenu(sidebar, 'Vector databases', 'Delete');
    dialog = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete chat' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    expect(await screen.findByText('Your saved chats will appear here.')).toBeInTheDocument();
  });

  it('keeps a chat as it was when the server refuses a change', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': modelsRoute,
      'GET /api/conversations': () =>
        jsonResponse({ conversations: [summary(conversationId, 'Vector databases')] }),
      [`PATCH /api/conversations/${conversationId}`]: () =>
        errorResponse(404, 'NOT_FOUND', 'This conversation does not exist.'),
      [`DELETE /api/conversations/${conversationId}`]: () =>
        errorResponse(500, 'INTERNAL_ERROR', 'Try again in a moment.'),
    });
    renderApp('/chat');
    const sidebar = await screen.findByRole('navigation', { name: 'Conversations' });
    await within(sidebar).findByRole('link', { name: 'Vector databases' });

    await chooseFromMenu(sidebar, 'Vector databases', 'Pin to top');
    expect(await within(sidebar).findByRole('alert')).toHaveTextContent(
      'This conversation does not exist.',
    );
    expect(within(sidebar).queryByRole('region', { name: 'Pinned' })).not.toBeInTheDocument();

    // A failed delete keeps the dialog open to retry or cancel.
    await chooseFromMenu(sidebar, 'Vector databases', 'Delete');
    const dialog = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete chat' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Try again in a moment.');
    expect(screen.getByRole('dialog', { name: 'Delete this chat?' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(sidebar).getByRole('link', { name: 'Vector databases' })).toBeInTheDocument();
  });

  it('says when personal instructions are on and links to them', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': modelsRoute,
      'GET /api/conversations': () => jsonResponse({ conversations: [] }),
      'GET /api/me/instructions': () =>
        jsonResponse({ instructions: { about: 'I am a nurse.', style: null, enabled: true } }),
    });
    renderApp('/chat');
    expect(await screen.findByRole('link', { name: 'Personal instructions on' })).toHaveAttribute(
      'href',
      '/settings',
    );
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
