import type { AIModel } from '@a-ai/shared-types';
import { OpenAICompatibleProvider } from './openai-compatible.js';

export type ProviderKey = 'groq' | 'openrouter' | 'gemini';

export const PROVIDER_LABELS: Readonly<Record<ProviderKey, string>> = {
  groq: 'Groq',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
};

/**
 * Models offered per provider (Phase 2 static list; Phase 3 moves this to the
 * model_registry table). Checked on the date below against:
 * - Groq: console.groq.com/docs/models and /docs/deprecations (Llama 3.x
 *   models were shut down 2026-08-16, so they are deliberately absent)
 * - OpenRouter: the public GET /api/v1/models response, ":free" variants
 * - Gemini: ai.google.dev/gemini-api/docs/models. Context and output limits
 *   are not published on that page; the values below are the long-standing
 *   Flash limits and must be confirmed with a real key.
 */
export const CATALOG_CHECKED_ON = '2026-09-13';

const text = {
  category: 'text',
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: false,
  // Unknown until an admin enters them: free tiers have limits, paid plans have prices.
  inputPricePerMillionUsd: null,
  outputPricePerMillionUsd: null,
} as const;

/** OpenRouter ":free" variants cost nothing. */
const free = {
  availability: 'free',
  inputPricePerMillionUsd: 0,
  outputPricePerMillionUsd: 0,
} as const;

export const MODEL_CATALOG: Readonly<Record<ProviderKey, readonly AIModel[]>> = {
  groq: [
    {
      ...text,
      id: 'openai/gpt-oss-120b',
      provider: 'groq',
      name: 'GPT-OSS 120B',
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      supportsTools: true,
      availability: 'free-tier',
    },
    {
      ...text,
      id: 'openai/gpt-oss-20b',
      provider: 'groq',
      name: 'GPT-OSS 20B',
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      supportsTools: true,
      availability: 'free-tier',
    },
  ],
  openrouter: [
    {
      ...text,
      id: 'google/gemma-4-31b-it:free',
      provider: 'openrouter',
      name: 'Gemma 4 31B',
      contextWindow: 262_144,
      maxOutputTokens: 32_768,
      ...free,
    },
    {
      ...text,
      id: 'nvidia/nemotron-3-super-120b-a12b:free',
      provider: 'openrouter',
      name: 'Nemotron 3 Super 120B',
      contextWindow: 262_144,
      maxOutputTokens: 32_768,
      ...free,
    },
  ],
  gemini: [
    {
      ...text,
      id: 'gemini-3.8-flash',
      provider: 'gemini',
      name: 'Gemini 3.8 Flash',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsTools: true,
      availability: 'free-tier',
    },
    {
      ...text,
      id: 'gemini-3.5-flash-lite',
      provider: 'gemini',
      name: 'Gemini 3.5 Flash-Lite',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsTools: true,
      availability: 'free-tier',
    },
  ],
};

const ENDPOINTS: Readonly<
  Record<ProviderKey, { baseUrl: string; maxTokensParam: 'max_tokens' | 'max_completion_tokens' }>
> = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', maxTokensParam: 'max_completion_tokens' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', maxTokensParam: 'max_tokens' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    maxTokensParam: 'max_tokens',
  },
};

export function createProvider(
  key: ProviderKey,
  apiKey: string,
  options: { fetchImpl?: typeof fetch; appName?: string } = {},
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: key,
    label: PROVIDER_LABELS[key],
    apiKey,
    models: [...MODEL_CATALOG[key]],
    ...ENDPOINTS[key],
    // OpenRouter attributes traffic to an app by this header; it is optional elsewhere.
    ...(key === 'openrouter' ? { headers: { 'X-Title': options.appName ?? 'A.ai' } } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
