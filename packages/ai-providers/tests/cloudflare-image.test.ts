import { AIProviderError } from '@a-ai/ai-core';
import { describe, expect, it } from 'vitest';
import { CloudflareImageProvider } from '../src/cloudflare-image.js';

type Call = { url: string; init: RequestInit };

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const MODEL = '@cf/black-forest-labs/flux-1-schnell';

function provider(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return {
    calls,
    adapter: new CloudflareImageProvider({ accountId: 'acc-1', apiToken: 'cf-test', fetchImpl }),
  };
}

const ok = () =>
  Response.json({
    success: true,
    errors: [],
    result: { image: Buffer.from(JPEG).toString('base64') },
  });

async function failure(promise: Promise<unknown>): Promise<AIProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AIProviderError) return error;
    throw error;
  }
  throw new Error('expected a provider error');
}

describe('Cloudflare Workers AI image adapter (no real calls)', () => {
  it('lists FLUX.1 [schnell] as its only model', () => {
    expect(provider(ok).adapter.models()).toEqual([
      { provider: 'cloudflare', id: MODEL, name: 'FLUX.1 [schnell]' },
    ]);
  });

  it('posts the prompt with 4 steps and decodes the JPEG', async () => {
    const { calls, adapter } = provider(ok);
    const progress: number[] = [];
    const image = await adapter.generate({
      model: MODEL,
      prompt: 'A lighthouse at dawn',
      onProgress: (value) => progress.push(value),
    });

    expect(image).toEqual({ mimeType: 'image/jpeg', data: JPEG });
    expect(progress).toEqual([0.1, 1]);
    expect(calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acc-1/ai/run/${MODEL}`,
    );
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer cf-test');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      prompt: 'A lighthouse at dawn',
      steps: 4,
    });
  });

  it('refuses a model it does not offer without calling Cloudflare', async () => {
    const { calls, adapter } = provider(ok);
    const error = await failure(adapter.generate({ model: '@cf/other/model', prompt: 'x' }));
    expect(error.code).toBe('MODEL_UNAVAILABLE');
    expect(calls).toHaveLength(0);
  });

  it('maps HTTP failures to the shared taxonomy', async () => {
    const limited = await failure(
      provider(() => new Response('{}', { status: 429 })).adapter.generate({
        model: MODEL,
        prompt: 'x',
      }),
    );
    expect(limited.code).toBe('RATE_LIMITED');
    const denied = await failure(
      provider(() => new Response('{}', { status: 403 })).adapter.generate({
        model: MODEL,
        prompt: 'x',
      }),
    );
    expect(denied.code).toBe('MODEL_UNAVAILABLE');
  });

  it('treats a missing, failed or corrupt image as a bad response', async () => {
    for (const body of [
      { success: true, result: {} },
      { success: false, errors: [{ message: 'nope' }], result: null },
      { success: true, result: { image: 'not base64!' } },
    ]) {
      const error = await failure(
        provider(() => Response.json(body)).adapter.generate({ model: MODEL, prompt: 'x' }),
      );
      expect(error.code).toBe('PROVIDER_BAD_RESPONSE');
    }
    const unreadable = await failure(
      provider(() => new Response('<html>')).adapter.generate({ model: MODEL, prompt: 'x' }),
    );
    expect(unreadable.code).toBe('PROVIDER_BAD_RESPONSE');
  });

  it('passes the caller abort through instead of reporting a provider failure', async () => {
    const controller = new AbortController();
    const reason = new DOMException('stopped', 'AbortError');
    const { adapter } = provider(() => {
      controller.abort(reason);
      throw reason;
    });
    await expect(
      adapter.generate({ model: MODEL, prompt: 'x', signal: controller.signal }),
    ).rejects.toBe(reason);
  });
});
