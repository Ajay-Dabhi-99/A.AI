import { AIProviderError, type TranscriptionResult } from '@a-ai/ai-core';
import { audioStatusSchema, transcriptionResponseSchema } from '@a-ai/validation';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../src/services/container.js';
import { ScriptedTranscriptionProvider } from '../helpers/image-provider.js';
import { multipartBody, png } from '../helpers/images.js';
import { oggAudio, webmAudio } from '../helpers/media.js';
import {
  buildAuthTestApp,
  testEnv,
  WEB_ORIGIN,
  type AuthTestContext,
} from '../helpers/test-app.js';

let ctx: AuthTestContext | undefined;

afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

async function setup(
  options: {
    result?: () => Promise<TranscriptionResult>;
    env?: Record<string, string>;
    services?: ServiceOverrides;
    enabled?: boolean;
  } = {},
) {
  const provider = new ScriptedTranscriptionProvider(
    options.result ??
      (async () => ({ text: '  Hello from my voice.  ', language: 'en', durationMs: 2300 })),
  );
  ctx = await buildAuthTestApp({
    ...(options.env ? { env: testEnv(options.env) } : {}),
    services: {
      ...(options.enabled === false ? {} : { transcription: provider }),
      ...options.services,
    },
  });
  return { app: ctx.app, provider };
}

function transcribe(
  app: AuthTestContext['app'],
  file: { data: Uint8Array; contentType?: string },
  query = '',
): Promise<LightMyRequestResponse> {
  const body = multipartBody([
    {
      name: 'file',
      filename: 'recording.webm',
      contentType: file.contentType ?? 'audio/webm;codecs=opus',
      data: file.data,
    },
  ]);
  return app.inject({
    method: 'POST',
    url: `/api/audio/transcriptions${query}`,
    headers: { origin: WEB_ORIGIN, ...body.headers },
    payload: body.payload,
  });
}

const errorOf = (response: LightMyRequestResponse) => ({
  status: response.statusCode,
  code: response.json().error.code as string,
});

describe('speech-to-text (Phase 9)', () => {
  it('is off, and says so, without a speech-to-text key', async () => {
    const { app } = await setup({ enabled: false });
    const status = audioStatusSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/audio/status' })).json(),
    );
    expect(status.transcription.enabled).toBe(false);
    expect(status.speech).toEqual({ mode: 'browser' });

    const response = await transcribe(app, { data: webmAudio() });
    expect(errorOf(response)).toEqual({ status: 503, code: 'MODEL_UNAVAILABLE' });
    expect(response.json().error.message).toBe('Voice input is not enabled on this deployment.');
  });

  it('transcribes a guest recording once and keeps nothing', async () => {
    const { app, provider } = await setup();
    expect(
      audioStatusSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/audio/status' })).json(),
      ).transcription,
    ).toMatchObject({ enabled: true, maxBytes: 10_485_760, maxDurationSeconds: 120 });

    const recording = webmAudio(256);
    const response = await transcribe(app, { data: recording }, '?language=EN');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(transcriptionResponseSchema.parse(response.json())).toEqual({
      transcript: {
        text: 'Hello from my voice.',
        language: 'en',
        durationMs: 2300,
        provider: 'groq',
        model: 'whisper-large-v3-turbo',
      },
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      model: 'whisper-large-v3-turbo',
      mimeType: 'audio/webm',
      fileName: 'recording.webm',
      language: 'en',
    });
    expect(provider.requests[0]?.audio).toEqual(recording);
    // The recording is not stored: the API has no storage call for audio at all.
  });

  it('rejects anything that is not a supported, honest, reasonably sized recording', async () => {
    const { app, provider } = await setup({ env: { AUDIO_MAX_BYTES: '102400' } });

    expect(errorOf(await transcribe(app, { data: png() }))).toEqual({
      status: 415,
      code: 'VALIDATION_ERROR',
    });
    expect(errorOf(await transcribe(app, { data: oggAudio(), contentType: 'audio/mpeg' }))).toEqual(
      {
        status: 415,
        code: 'VALIDATION_ERROR',
      },
    );
    expect(errorOf(await transcribe(app, { data: new Uint8Array(0) }))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(errorOf(await transcribe(app, { data: webmAudio(150_000) }))).toEqual({
      status: 413,
      code: 'VALIDATION_ERROR',
    });
    expect(errorOf(await transcribe(app, { data: webmAudio() }, '?language=english'))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    const notMultipart = await app.inject({
      method: 'POST',
      url: '/api/audio/transcriptions',
      headers: { origin: WEB_ORIGIN },
      payload: { audio: 'x' },
    });
    expect(errorOf(notMultipart)).toEqual({ status: 415, code: 'VALIDATION_ERROR' });

    expect(provider.requests).toHaveLength(0);
  });

  it('passes provider limits through and refuses empty transcripts', async () => {
    let call = 0;
    const { app } = await setup({
      result: async () => {
        call += 1;
        if (call === 1) {
          throw new AIProviderError({
            provider: 'groq',
            code: 'RATE_LIMITED',
            message: 'Groq returned HTTP 429',
            retryAfterSeconds: 20,
          });
        }
        return { text: '   ', language: null, durationMs: 400 };
      },
    });

    const limited = await transcribe(app, { data: webmAudio() });
    expect(errorOf(limited)).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(limited.headers['retry-after']).toBe('20');

    const silent = await transcribe(app, { data: webmAudio() });
    expect(errorOf(silent)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    expect(silent.json().error.message).toContain('No speech was recognized');
  });

  it('rate limits guests', async () => {
    const { app } = await setup({
      services: {
        rateLimits: { transcribeByGuest: { name: 'stt-guest', limit: 1, windowMs: 60_000 } },
      },
    });
    const first = await transcribe(app, { data: webmAudio() });
    expect(first.statusCode).toBe(200);
    const guestCookie = first.cookies.find((cookie) => cookie.name === 'a_ai_guest');
    const body = multipartBody([
      { name: 'file', filename: 'r.webm', contentType: 'audio/webm', data: webmAudio() },
    ]);
    const second = await app.inject({
      method: 'POST',
      url: '/api/audio/transcriptions',
      headers: { origin: WEB_ORIGIN, ...body.headers },
      cookies: { a_ai_guest: guestCookie!.value },
      payload: body.payload,
    });
    expect(errorOf(second)).toEqual({ status: 429, code: 'RATE_LIMITED' });
  });
});
