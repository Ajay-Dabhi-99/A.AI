import {
  AIProviderError,
  type AIChatRequest,
  type AIProvider,
  type AIResponse,
  type AIStreamChunk,
} from '@a-ai/ai-core';
import type { AIFinishReason, AIModel, AIUsage } from '@a-ai/shared-types';
import { classifyHttpStatus, providerFetch } from './http.js';
import { parseSseStream } from './sse.js';

export type OpenAICompatibleOptions = {
  /** Provider key, e.g. "groq". */
  id: string;
  /** Human-readable name used in error messages. */
  label: string;
  /** Up to and excluding `/chat/completions`. */
  baseUrl: string;
  apiKey: string;
  models: AIModel[];
  /** Name of the output-length parameter this API accepts. */
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
  headers?: Record<string, string>;
  /** Until response headers arrive. Default 20 s. */
  connectTimeoutMs?: number;
  /** Longest silence allowed while streaming. Default 45 s. */
  idleTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type WireUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

type CompletionChunk = {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: WireUsage | null;
  /** Groq reports usage here on the final chunk. */
  x_groq?: { usage?: WireUsage | null };
  /** OpenRouter reports mid-stream failures here with finish_reason "error". */
  error?: { message?: string; code?: number | string };
};

function toFinishReason(value: string): AIFinishReason {
  if (value === 'stop' || value === 'length' || value === 'content_filter') return value;
  return 'unknown';
}

function toUsage(wire: WireUsage | null | undefined): AIUsage | undefined {
  if (!wire) return undefined;
  const usage: AIUsage = { source: 'provider' };
  if (typeof wire.prompt_tokens === 'number') usage.inputTokens = wire.prompt_tokens;
  if (typeof wire.completion_tokens === 'number') usage.outputTokens = wire.completion_tokens;
  if (typeof wire.total_tokens === 'number') usage.totalTokens = wire.total_tokens;
  return usage.inputTokens === undefined && usage.outputTokens === undefined ? undefined : usage;
}

/**
 * One adapter for every provider that speaks the OpenAI Chat Completions
 * streaming protocol (ADR-009): Groq, OpenRouter and Gemini's compatibility
 * endpoint. Differences are configuration, not code.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  readonly #options: Required<Omit<OpenAICompatibleOptions, 'headers' | 'fetchImpl'>> &
    Pick<OpenAICompatibleOptions, 'headers' | 'fetchImpl'>;

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id;
    this.#options = { connectTimeoutMs: 20_000, idleTimeoutMs: 45_000, ...options };
  }

  async getModels(): Promise<AIModel[]> {
    return this.#options.models;
  }

  async chat(request: AIChatRequest): Promise<AIResponse> {
    let text = '';
    let usage: AIUsage = { source: 'estimated' };
    let finishReason: AIFinishReason = 'unknown';
    for await (const chunk of this.stream(request)) {
      if (chunk.type === 'delta') text += chunk.text;
      else if (chunk.type === 'usage') usage = chunk.usage;
      else finishReason = chunk.finishReason;
    }
    return { provider: this.id, model: request.model, text, usage, finishReason };
  }

  async *stream(request: AIChatRequest): AsyncGenerator<AIStreamChunk, void, undefined> {
    const { label, baseUrl, apiKey, headers, maxTokensParam, connectTimeoutMs, idleTimeoutMs } =
      this.#options;
    const idle = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, idle.signal]) : idle.signal;

    const response = await providerFetch({
      provider: this.id,
      url: `${baseUrl}/chat/completions`,
      timeoutMs: connectTimeoutMs,
      signal,
      ...(this.#options.fetchImpl ? { fetchImpl: this.#options.fetchImpl } : {}),
      init: {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...headers,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined
            ? {}
            : { [maxTokensParam]: request.maxOutputTokens }),
        }),
      },
    });

    if (!response.body) {
      throw new AIProviderError({
        provider: this.id,
        code: 'PROVIDER_BAD_RESPONSE',
        message: `${label} returned an empty response`,
      });
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const armIdleTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => idle.abort(), idleTimeoutMs);
    };

    let finishReason: AIFinishReason = 'unknown';
    let finished = false;
    armIdleTimer();
    try {
      for await (const message of parseSseStream(response.body)) {
        armIdleTimer();
        if (message.data === '[DONE]') break;

        let chunk: CompletionChunk;
        try {
          chunk = JSON.parse(message.data) as CompletionChunk;
        } catch {
          throw new AIProviderError({
            provider: this.id,
            code: 'PROVIDER_BAD_RESPONSE',
            message: `${label} sent an unreadable stream event`,
          });
        }

        if (chunk.error) {
          const status = Number(chunk.error.code);
          const { code, retryable } = Number.isInteger(status)
            ? classifyHttpStatus(status)
            : { code: 'PROVIDER_BAD_RESPONSE' as const, retryable: false };
          throw new AIProviderError({
            provider: this.id,
            code,
            retryable,
            message: `${label} reported an error while answering`,
          });
        }

        const choice = chunk.choices?.[0];
        const text = choice?.delta?.content;
        if (text) yield { type: 'delta', text };
        if (choice?.finish_reason) finishReason = toFinishReason(choice.finish_reason);

        const usage = toUsage(chunk.usage ?? chunk.x_groq?.usage);
        if (usage) yield { type: 'usage', usage };
      }
      finished = true;
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      if (idle.signal.aborted) {
        throw new AIProviderError({
          provider: this.id,
          code: 'PROVIDER_TIMEOUT',
          message: `${label} stopped responding for ${Math.round(idleTimeoutMs / 1000)}s`,
          cause: error,
        });
      }
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError({
        provider: this.id,
        code: 'MODEL_UNAVAILABLE',
        retryable: true,
        message: `${label} connection was interrupted`,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      // Consumer stopped early or we failed: release the upstream connection.
      if (!finished) await response.body.cancel().catch(() => undefined);
    }

    yield { type: 'done', finishReason };
  }
}
