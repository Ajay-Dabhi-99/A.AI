import {
  AIProviderError,
  type MediaModel,
  type TranscriptionProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
} from '@a-ai/ai-core';
import { providerFetch } from './http.js';

/** Speech-to-text models this deployment can use (Phase 9, ADR-016). */
export const GROQ_TRANSCRIPTION_MODELS: readonly MediaModel[] = [
  { provider: 'groq', id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo' },
];

export type GroqTranscriptionOptions = {
  apiKey: string;
  baseUrl?: string;
  /** Until response headers arrive; transcription answers in one response. Default 60 s. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type WireTranscription = { text?: unknown; language?: unknown; duration?: unknown };

/** Whisper's verbose output names the language ("english"); the API reports ISO 639-1. */
const LANGUAGE_CODES: Readonly<Record<string, string>> = {
  english: 'en',
  hindi: 'hi',
  gujarati: 'gu',
  marathi: 'mr',
  bengali: 'bn',
  tamil: 'ta',
  telugu: 'te',
  urdu: 'ur',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  russian: 'ru',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  arabic: 'ar',
  dutch: 'nl',
  turkish: 'tr',
};

function toLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  return LANGUAGE_CODES[normalized] ?? null;
}

/**
 * Groq's OpenAI-compatible transcription endpoint
 * (`POST /audio/transcriptions`, multipart). The recording is sent once and
 * is not kept by A.ai; failures use the shared provider error taxonomy.
 */
export class GroqTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'groq';
  readonly #options: Required<Omit<GroqTranscriptionOptions, 'fetchImpl'>> &
    Pick<GroqTranscriptionOptions, 'fetchImpl'>;

  constructor(options: GroqTranscriptionOptions) {
    this.#options = {
      baseUrl: 'https://api.groq.com/openai/v1',
      timeoutMs: 60_000,
      ...options,
    };
  }

  models(): MediaModel[] {
    return [...GROQ_TRANSCRIPTION_MODELS];
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const { apiKey, baseUrl, timeoutMs, fetchImpl } = this.#options;
    const form = new FormData();
    form.append(
      'file',
      new Blob([request.audio.slice()], { type: request.mimeType }),
      request.fileName,
    );
    form.append('model', request.model);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (request.language) form.append('language', request.language);

    const response = await providerFetch({
      provider: this.id,
      url: `${baseUrl}/audio/transcriptions`,
      timeoutMs,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
      init: { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form },
    });

    const unreadable = () =>
      new AIProviderError({
        provider: this.id,
        code: 'PROVIDER_BAD_RESPONSE',
        message: 'Groq returned an unreadable transcription',
      });
    let body: WireTranscription;
    try {
      body = (await response.json()) as WireTranscription;
    } catch {
      throw unreadable();
    }
    if (typeof body.text !== 'string') throw unreadable();

    return {
      text: body.text.trim(),
      language: toLanguage(body.language),
      durationMs:
        typeof body.duration === 'number' && Number.isFinite(body.duration) && body.duration >= 0
          ? Math.round(body.duration * 1000)
          : null,
    };
  }
}
