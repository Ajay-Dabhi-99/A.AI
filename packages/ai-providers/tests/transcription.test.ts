import { AIProviderError } from '@a-ai/ai-core';
import { describe, expect, it } from 'vitest';
import { GroqTranscriptionProvider } from '../src/transcription.js';

type Call = { url: string; init: RequestInit };

function provider(respond: () => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { calls, adapter: new GroqTranscriptionProvider({ apiKey: 'gsk-test', fetchImpl }) };
}

const request = {
  model: 'whisper-large-v3-turbo',
  audio: Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]),
  mimeType: 'audio/webm',
  fileName: 'recording.webm',
};

describe('Groq transcription adapter (no real calls)', () => {
  it('posts the recording as multipart and normalizes the verbose answer', async () => {
    const { calls, adapter } = provider(() =>
      Response.json({ text: '  Hello from A.ai.  ', language: 'english', duration: 1.25 }),
    );
    const result = await adapter.transcribe({ ...request, language: 'en' });

    expect(result).toEqual({ text: 'Hello from A.ai.', language: 'en', durationMs: 1250 });
    expect(calls[0]?.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      'Bearer gsk-test',
    );

    const form = calls[0]?.init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('language')).toBe('en');
    const file = form.get('file') as File;
    expect(file.name).toBe('recording.webm');
    expect(file.type).toBe('audio/webm');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(request.audio);
  });

  it('lets the provider detect the language when no hint is given', async () => {
    const { calls, adapter } = provider(() => Response.json({ text: 'Namaste', language: 'hi' }));
    expect(await adapter.transcribe(request)).toEqual({
      text: 'Namaste',
      language: 'hi',
      durationMs: null,
    });
    expect((calls[0]?.init.body as FormData).has('language')).toBe(false);
  });

  it('maps provider failures to the shared error taxonomy', async () => {
    const limited = provider(
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '20' } }),
    );
    const error = await limited.adapter.transcribe(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIProviderError);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 20 });
    expect((error as Error).message).not.toContain('slow down');

    const garbled = provider(() => new Response('not json', { status: 200 }));
    await expect(garbled.adapter.transcribe(request)).rejects.toMatchObject({
      code: 'PROVIDER_BAD_RESPONSE',
    });
    const missingText = provider(() => Response.json({ language: 'en' }));
    await expect(missingText.adapter.transcribe(request)).rejects.toMatchObject({
      code: 'PROVIDER_BAD_RESPONSE',
    });
  });
});
