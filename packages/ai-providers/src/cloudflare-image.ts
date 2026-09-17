import {
  AIProviderError,
  type GeneratedMedia,
  type MediaGenerationProvider,
  type MediaGenerationRequest,
  type MediaModel,
} from '@a-ai/ai-core';
import { providerFetch } from './http.js';

/**
 * Image models on Cloudflare Workers AI. The Workers Free plan includes
 * 10,000 neurons a day; FLUX.1 [schnell] at 1024x1024 and 4 steps costs about
 * 58 (4.80 per 512x512 tile, 9.60 per step; checked 2026-09-17).
 */
export const CLOUDFLARE_IMAGE_MODELS: readonly MediaModel[] = [
  { provider: 'cloudflare', id: '@cf/black-forest-labs/flux-1-schnell', name: 'FLUX.1 [schnell]' },
];

/** FLUX.1 [schnell] accepts 1–8 steps; 4 is its default and the cheapest good result. */
const FLUX_STEPS = 4;

export type CloudflareImageOptions = {
  accountId: string;
  apiToken: string;
  baseUrl?: string;
  /** Until the response arrives; the image comes back in one response. Default 60 s. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type WireResult = {
  success?: unknown;
  result?: { image?: unknown } | null;
  errors?: { message?: unknown }[];
};

function decodeBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    return Uint8Array.from(Buffer.from(value, 'base64'));
  } catch {
    return null;
  }
}

/**
 * Text-to-image through the Workers AI REST API
 * (`POST /accounts/{id}/ai/run/{model}`). The image arrives base64-encoded
 * (JPEG); the API still checks the bytes before storing them.
 */
export class CloudflareImageProvider implements MediaGenerationProvider {
  readonly id = 'cloudflare';
  readonly #options: Required<Omit<CloudflareImageOptions, 'fetchImpl'>> &
    Pick<CloudflareImageOptions, 'fetchImpl'>;

  constructor(options: CloudflareImageOptions) {
    this.#options = {
      baseUrl: 'https://api.cloudflare.com/client/v4',
      timeoutMs: 60_000,
      ...options,
    };
  }

  models(): MediaModel[] {
    return [...CLOUDFLARE_IMAGE_MODELS];
  }

  async generate(request: MediaGenerationRequest): Promise<GeneratedMedia> {
    const { accountId, apiToken, baseUrl, timeoutMs, fetchImpl } = this.#options;
    if (!CLOUDFLARE_IMAGE_MODELS.some((model) => model.id === request.model)) {
      throw new AIProviderError({
        provider: this.id,
        code: 'MODEL_UNAVAILABLE',
        message: `Cloudflare model ${request.model} is not enabled`,
      });
    }

    request.onProgress?.(0.1);
    const response = await providerFetch({
      provider: this.id,
      url: `${baseUrl}/accounts/${encodeURIComponent(accountId)}/ai/run/${request.model}`,
      timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
      init: {
        method: 'POST',
        headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: request.prompt, steps: FLUX_STEPS }),
      },
    });

    const unreadable = (detail: string) =>
      new AIProviderError({
        provider: this.id,
        code: 'PROVIDER_BAD_RESPONSE',
        message: `Cloudflare returned ${detail}`,
      });
    let body: WireResult;
    try {
      body = (await response.json()) as WireResult;
    } catch {
      throw unreadable('an unreadable response');
    }
    if (body.success === false) throw unreadable('an error instead of an image');
    const encoded = body.result?.image;
    if (typeof encoded !== 'string' || encoded.length === 0) throw unreadable('no image');
    const data = decodeBase64(encoded);
    if (!data || data.length === 0) throw unreadable('an image that is not valid base64');

    request.onProgress?.(1);
    return { mimeType: 'image/jpeg', data };
  }
}
