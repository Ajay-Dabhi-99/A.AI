import { AIProviderError, type AIStreamChunk } from '@a-ai/ai-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createProvider,
  MODEL_CATALOG,
  OpenAICompatibleProvider,
  type OpenAICompatibleOptions,
  type ProviderKey,
} from '../src/index.js';

type Step = { data?: string; raw?: string; wait?: number };

/**
 * A streaming Response whose events arrive in order, optionally with pauses.
 * Like a real fetch body, it errors when the request's signal aborts.
 */
function sseResponse(
  steps: Step[],
  options: { hangAtEnd?: boolean; signal?: AbortSignal | null } = {},
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let aborted = false;
      options.signal?.addEventListener(
        'abort',
        () => {
          aborted = true;
          controller.error(options.signal?.reason);
        },
        { once: true },
      );
      for (const step of steps) {
        if (step.wait) await new Promise((resolve) => setTimeout(resolve, step.wait));
        if (aborted) return;
        if (step.raw !== undefined) controller.enqueue(encoder.encode(step.raw));
        if (step.data !== undefined) controller.enqueue(encoder.encode(`data: ${step.data}\n\n`));
      }
      if (!options.hangAtEnd && !aborted) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const delta = (content: string) => JSON.stringify({ choices: [{ delta: { content } }] });

function provider(fetchImpl: typeof fetch, overrides: Partial<OpenAICompatibleOptions> = {}) {
  return new OpenAICompatibleProvider({
    id: 'test',
    label: 'Test AI',
    baseUrl: 'https://llm.example/v1',
    apiKey: 'sk-test',
    models: [],
    maxTokensParam: 'max_tokens',
    fetchImpl,
    ...overrides,
  });
}

async function collect(stream: AsyncIterable<AIStreamChunk>): Promise<AIStreamChunk[]> {
  const chunks: AIStreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

async function failure(stream: AsyncIterable<AIStreamChunk>): Promise<unknown> {
  try {
    await collect(stream);
  } catch (error) {
    return error;
  }
  throw new Error('expected the stream to fail');
}

const request = { model: 'm-1', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('OpenAICompatibleProvider.stream', () => {
  it('sends a streaming chat completion request', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([{ data: '[DONE]' }]));
    await collect(
      provider(fetchImpl, { maxTokensParam: 'max_completion_tokens' }).stream({
        ...request,
        temperature: 0.4,
        maxOutputTokens: 512,
      }),
    );

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'm-1',
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.4,
      max_completion_tokens: 512,
    });
  });

  it('yields deltas, provider usage and the finish reason, ignoring keep-alive comments', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        { raw: ': OPENROUTER PROCESSING\n\n' },
        { data: delta('Hel') },
        { data: delta('lo') },
        { data: JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) },
        {
          data: JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
          }),
        },
        { data: '[DONE]' },
      ]),
    );

    expect(await collect(provider(fetchImpl).stream(request))).toEqual([
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
      {
        type: 'usage',
        usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11, source: 'provider' },
      },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('reads Groq usage from x_groq', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        {
          data: JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'length' }],
            x_groq: { usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
          }),
        },
      ]),
    );
    const chunks = await collect(provider(fetchImpl).stream(request));
    expect(chunks).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7, source: 'provider' },
    });
    expect(chunks.at(-1)).toEqual({ type: 'done', finishReason: 'length' });
  });

  it('turns a mid-stream error event into a classified provider error', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        { data: delta('partial') },
        {
          data: JSON.stringify({
            error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' },
            choices: [{ delta: { content: '' }, finish_reason: 'error' }],
          }),
        },
      ]),
    );
    const error = await failure(provider(fetchImpl).stream(request));
    expect(error).toBeInstanceOf(AIProviderError);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryable: true, provider: 'test' });
    expect((error as Error).message).not.toContain('free-models-per-day');
  });

  it('maps HTTP failures before streaming', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"error":"invalid key sk-test"}', { status: 401 }),
    );
    const error = await failure(provider(fetchImpl).stream(request));
    expect(error).toMatchObject({ code: 'MODEL_UNAVAILABLE', retryable: false, status: 401 });
  });

  it('rejects unreadable events as PROVIDER_BAD_RESPONSE', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([{ data: '{not json' }]));
    expect(await failure(provider(fetchImpl).stream(request))).toMatchObject({
      code: 'PROVIDER_BAD_RESPONSE',
    });
  });

  it('fails with PROVIDER_TIMEOUT when the stream goes silent', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      sseResponse([{ data: delta('thinking') }], { hangAtEnd: true, signal: init?.signal }),
    );
    const chunks: AIStreamChunk[] = [];
    let caught: unknown;
    try {
      for await (const chunk of provider(fetchImpl as typeof fetch, { idleTimeoutMs: 40 }).stream(
        request,
      )) {
        chunks.push(chunk);
      }
    } catch (error) {
      caught = error;
    }
    expect(chunks).toEqual([{ type: 'delta', text: 'thinking' }]);
    expect(caught).toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true });
  });

  it('does not apply the connect timeout to a long stream', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([{ data: delta('a') }, { data: delta('b'), wait: 60 }, { data: '[DONE]' }]),
    );
    const chunks = await collect(
      provider(fetchImpl, { connectTimeoutMs: 20, idleTimeoutMs: 1_000 }).stream(request),
    );
    expect(chunks.filter((chunk) => chunk.type === 'delta')).toHaveLength(2);
  });

  it('rethrows caller cancellation instead of a provider error', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      sseResponse([{ data: delta('one') }], { hangAtEnd: true, signal: init?.signal }),
    );

    let caught: unknown;
    try {
      for await (const chunk of provider(fetchImpl as typeof fetch).stream({
        ...request,
        signal: controller.signal,
      })) {
        if (chunk.type === 'delta')
          controller.abort(new DOMException('user pressed stop', 'AbortError'));
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeInstanceOf(AIProviderError);
    expect(caught).toMatchObject({ name: 'AbortError', message: 'user pressed stop' });
  });
});

describe('OpenAICompatibleProvider.chat', () => {
  it('collects the full text and labels missing usage as estimated', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([{ data: delta('4') }, { data: delta('2') }, { data: '[DONE]' }]),
    );
    expect(await provider(fetchImpl).chat(request)).toEqual({
      provider: 'test',
      model: 'm-1',
      text: '42',
      usage: { source: 'estimated' },
      finishReason: 'unknown',
    });
  });
});

describe('catalog', () => {
  it.each([
    ['groq', 'https://api.groq.com/openai/v1/chat/completions', 'max_completion_tokens'],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'max_tokens'],
    [
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      'max_tokens',
    ],
  ] as const)('%s calls %s with %s', async (key, url, maxParam) => {
    const fetchImpl = vi.fn(async () => sseResponse([{ data: '[DONE]' }]));
    await collect(
      createProvider(key, 'key-1', { fetchImpl }).stream({ ...request, maxOutputTokens: 10 }),
    );
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(JSON.parse(init.body as string)).toHaveProperty(maxParam, 10);
  });

  it('lists only models that belong to their provider, with sane limits', () => {
    for (const [key, models] of Object.entries(MODEL_CATALOG) as [
      ProviderKey,
      typeof MODEL_CATALOG.groq,
    ][]) {
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        expect(model.provider).toBe(key);
        expect(model.maxOutputTokens).toBeLessThan(model.contextWindow);
      }
    }
    expect(MODEL_CATALOG.groq.map((model) => model.id)).not.toContain('llama-3.3-70b-versatile');
  });
});
