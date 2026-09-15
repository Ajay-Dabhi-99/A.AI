import type { AIModel } from '@a-ai/shared-types';
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

const model = (provider: string, id: string, name: string): AIModel => ({
  id,
  provider,
  name,
  category: 'text',
  contextWindow: 131_072,
  maxOutputTokens: 8_192,
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: false,
  availability: 'free-tier',
  inputPricePerMillionUsd: null,
  outputPricePerMillionUsd: null,
});

const models = [
  model('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B'),
  model('gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash'),
  model('openrouter', 'meta-llama/llama-4', 'Llama 4 Maverick'),
];

const providers = [
  { id: 'groq', name: 'Groq', configured: true },
  { id: 'gemini', name: 'Gemini', configured: true },
  { id: 'openrouter', name: 'OpenRouter', configured: true },
];

const modelsRoute =
  (list: AIModel[] = models) =>
  () =>
    jsonResponse({
      models: list,
      providers,
      defaultModel: { provider: 'groq', id: 'openai/gpt-oss-20b' },
    });

type StreamEvent = [name: string, data: object];

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

const GROQ_REF = { provider: 'groq', model: 'openai/gpt-oss-20b' };
const GEMINI_REF = { provider: 'gemini', model: 'gemini-3.8-flash' };
const START: StreamEvent = [
  'comparison.start',
  {
    comparisonId: 'c1',
    runs: [
      { runId: 'r1', ...GROQ_REF },
      { runId: 'r2', ...GEMINI_REF },
    ],
  },
];

const partialFailure: StreamEvent[] = [
  START,
  ['message.delta', { runId: 'r1', text: 'Vectors are **fast**' }],
  [
    'error',
    {
      runId: 'r2',
      status: 'failed',
      latencyMs: 300,
      code: 'RATE_LIMITED',
      message: 'Gemini is rate limiting requests',
      retryable: true,
    },
  ],
  ['usage', { runId: 'r1', usage: { inputTokens: 12, outputTokens: 30, source: 'provider' } }],
  [
    'message.done',
    { runId: 'r1', status: 'completed', latencyMs: 1250, ttftMs: 200, estimatedCost: null },
  ],
  ['comparison.done', { comparisonId: 'c1' }],
];

async function typePromptAndCompare(prompt: string, buttonName = 'Compare 2 models') {
  fireEvent.change(await screen.findByLabelText('Prompt'), { target: { value: prompt } });
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
}

describe('compare page as a guest', () => {
  it('shows each model in its own column and keeps a failed model from affecting the others', async () => {
    const api = mockApi({
      ...baseRoutes,
      'GET /api/models': modelsRoute(),
      'POST /api/compare': (init) => sse(partialFailure, init),
    });
    renderApp('/compare');

    expect(await screen.findByRole('heading', { name: 'Compare models' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compare' })).toHaveAttribute('href', '/compare');
    // Guests compare two models: the first two are chosen and the third is locked.
    expect(screen.getByRole('checkbox', { name: 'GPT-OSS 20B' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Gemini 3.8 Flash' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Llama 4 Maverick' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Create a free account' })).toBeInTheDocument();

    await typePromptAndCompare('Explain vector databases');

    const groq = await screen.findByRole('article', { name: 'GPT-OSS 20B via Groq' });
    expect(await within(groq).findByText('fast')).toBeInTheDocument();
    await waitFor(() => expect(within(groq).getByText('Done')).toBeInTheDocument());
    expect(within(groq).getByText('1.25s')).toBeInTheDocument();
    expect(within(groq).getByText('0.20s')).toBeInTheDocument();
    expect(within(groq).getByText('12 → 30')).toBeInTheDocument();

    const gemini = screen.getByRole('article', { name: 'Gemini 3.8 Flash via Gemini' });
    expect(within(gemini).getByText('Gemini is rate limiting requests')).toBeInTheDocument();
    expect(within(gemini).getByText('Failed')).toBeInTheDocument();
    expect(within(gemini).getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    const [request] = callsTo(api, 'POST /api/compare');
    expect(JSON.parse(request!.body as string)).toEqual({
      prompt: 'Explain vector databases',
      models: [GROQ_REF, GEMINI_REF],
    });
  });

  it('retries only the failed column', async () => {
    const api = mockApi({
      ...baseRoutes,
      'GET /api/models': modelsRoute(),
      'POST /api/compare': (init) => sse(partialFailure, init),
      'POST /api/compare/c1/runs': (init) =>
        sse(
          [
            ['comparison.start', { comparisonId: 'c1', runs: [{ runId: 'r3', ...GEMINI_REF }] }],
            ['message.delta', { runId: 'r3', text: 'Second try worked' }],
            [
              'message.done',
              { runId: 'r3', status: 'completed', latencyMs: 800, ttftMs: 100, estimatedCost: 0 },
            ],
            ['comparison.done', { comparisonId: 'c1' }],
          ],
          init,
        ),
    });
    renderApp('/compare');
    await typePromptAndCompare('Explain vector databases');

    const gemini = await screen.findByRole('article', { name: 'Gemini 3.8 Flash via Gemini' });
    fireEvent.click(await within(gemini).findByRole('button', { name: 'Retry' }));

    expect(await within(gemini).findByText('Second try worked')).toBeInTheDocument();
    await waitFor(() => expect(within(gemini).getByText('Free')).toBeInTheDocument());
    const groq = screen.getByRole('article', { name: 'GPT-OSS 20B via Groq' });
    expect(within(groq).getByText('fast')).toBeInTheDocument();
    const [retry] = callsTo(api, 'POST /api/compare/c1/runs');
    expect(JSON.parse(retry!.body as string)).toEqual(GEMINI_REF);
  });

  it('shows a comparison rejected before it started and keeps the prompt', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/models': modelsRoute(),
      'POST /api/compare': () =>
        errorResponse(
          429,
          'QUOTA_EXCEEDED',
          'Comparing 2 models uses 2 messages, and not enough are left today.',
        ),
    });
    renderApp('/compare');
    await typePromptAndCompare('Explain vector databases');

    expect(
      await screen.findByText('Comparing 2 models uses 2 messages, and not enough are left today.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create a free account for a higher daily limit' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt')).toHaveValue('Explain vector databases');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('stops every running column', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/models': modelsRoute(),
      'POST /api/compare': (init) =>
        sse([START, ['message.delta', { runId: 'r1', text: 'Partial answer' }]], init, {
          hang: true,
        }),
    });
    renderApp('/compare');
    await typePromptAndCompare('Explain vector databases');

    const groq = await screen.findByRole('article', { name: 'GPT-OSS 20B via Groq' });
    await within(groq).findByText('Partial answer');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(screen.getAllByText('Stopped')).toHaveLength(2));
    expect(within(groq).getByText('Partial answer')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Compare 2 models' })).toBeInTheDocument();
  });
});

describe('compare page limits and empty state', () => {
  it('lets signed-in users choose up to their limit', async () => {
    mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/models': modelsRoute(),
    });
    renderApp('/compare');

    const third = await screen.findByRole('checkbox', { name: 'Llama 4 Maverick' });
    expect(third).toBeEnabled();
    fireEvent.click(third);
    expect(screen.getByText('3 of 4 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare 3 models' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'hello' } });
    expect(screen.getByRole('button', { name: 'Compare 3 models' })).toBeEnabled();
  });

  it('explains that at least two models are needed', async () => {
    mockApi({ ...baseRoutes, 'GET /api/models': modelsRoute([models[0]!]) });
    renderApp('/compare');

    expect(
      await screen.findByText('Comparison needs at least two available models'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Compare/ })).not.toBeInTheDocument();
  });
});
