import type { AIModel } from '@a-ai/shared-types';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelStore } from '../src/stores/model-store';
import { baseRoutes, callsTo, jsonResponse, mockApi, renderApp } from './helpers/render';

const model: AIModel = {
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
};

const audioStatus = (enabled: boolean) => ({
  transcription: {
    enabled,
    maxBytes: 10_485_760,
    maxDurationSeconds: 120,
    mimeTypes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/flac'],
  },
  speech: { mode: 'browser' },
});

function routes(extra: Record<string, (init: RequestInit | undefined) => Response> = {}) {
  return {
    ...baseRoutes,
    'GET /api/models': () =>
      jsonResponse({
        models: [model],
        providers: [{ id: 'groq', name: 'Groq', configured: true }],
        defaultModel: { provider: 'groq', id: model.id },
      }),
    'GET /api/guest/conversation': () =>
      jsonResponse({
        messages: [
          { id: 'm1', role: 'user', content: 'Hi', createdAt: '2026-09-17T10:00:00.000Z' },
          {
            id: 'm2',
            role: 'assistant',
            content: '**Hello** there, `friend`.',
            createdAt: '2026-09-17T10:00:01.000Z',
            run: { provider: 'groq', model: model.id, status: 'completed', latencyMs: 800 },
          },
        ],
        expiresAt: '2026-09-18T10:00:00.000Z',
      }),
    ...extra,
  };
}

class FakeUtterance {
  text: string;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const stopTrack = vi.fn();

class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? '';
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

beforeEach(() => {
  useModelStore.setState({ selected: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  stopTrack.mockReset();
});

describe('read aloud (browser speech)', () => {
  it('reads an answer as plain text and stops on a second click', async () => {
    const synth = { speak: vi.fn(), cancel: vi.fn() };
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    mockApi(routes());
    renderApp('/chat');

    fireEvent.click(await screen.findByRole('button', { name: 'Read aloud' }));
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect((synth.speak.mock.calls[0]?.[0] as FakeUtterance).text).toBe('Hello there, friend.');

    const stop = screen.getByRole('button', { name: 'Stop reading' });
    expect(stop).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(stop);
    expect(synth.cancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeInTheDocument();
  });

  it('is not offered when the browser has no speech voices', async () => {
    mockApi(routes());
    renderApp('/chat');
    expect(await screen.findByText('Hello')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument();
  });
});

describe('voice input (speech-to-text)', () => {
  function stubRecording() {
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
    });
  }

  it('records, transcribes and puts the text in the draft for review', async () => {
    stubRecording();
    const api = mockApi(
      routes({
        'GET /api/audio/status': () => jsonResponse(audioStatus(true)),
        'POST /api/audio/transcriptions': () =>
          jsonResponse({
            transcript: {
              text: 'What is the weather like',
              language: 'en',
              durationMs: 1800,
              provider: 'groq',
              model: 'whisper-large-v3-turbo',
            },
          }),
      }),
    );
    renderApp('/chat');

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Quick one:' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Record voice message' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Message')).toHaveValue('Quick one: What is the weather like'),
    );
    expect(stopTrack).toHaveBeenCalled();
    const [upload] = callsTo(api, 'POST /api/audio/transcriptions');
    const file = (upload?.body as FormData).get('file') as File;
    expect(file.name).toBe('recording.webm');
    expect(file.type).toBe('audio/webm;codecs=opus');
    // Nothing is sent to the model until the user presses send.
    expect(callsTo(api, 'POST /api/chat')).toHaveLength(0);
  });

  it('is not offered when speech-to-text is off', async () => {
    stubRecording();
    mockApi(routes({ 'GET /api/audio/status': () => jsonResponse(audioStatus(false)) }));
    renderApp('/chat');
    expect(await screen.findByText('Hello')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Record voice message' }),
      ).not.toBeInTheDocument(),
    );
  });
});
