import type { TranscriptionProvider } from '@a-ai/ai-core';
import type { AudioStatus, TranscriptionResponse } from '@a-ai/shared-types';
import { AUDIO_MIME_TYPES, RECORDING_MAX_SECONDS } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import { audioTypeMatches, sniffAudio } from '../../ai/media-sniff.js';
import type { RateLimiter, RateLimitRule } from '../../services/rate-limit.service.js';
import { AppError } from '../../shared/errors/app-error.js';

/** Longest a transcription may take; recordings are at most two minutes. */
export const TRANSCRIPTION_TIMEOUT_MS = 60_000;

export type TranscriptionSubject =
  { kind: 'user'; userId: string } | { kind: 'guest'; guestId: string; ipHash: string };

export type TranscriptionServiceDeps = {
  /** Null when no speech-to-text key is configured: voice input is off, never faked. */
  provider: TranscriptionProvider | null;
  rateLimiter: RateLimiter;
  rules: { user: RateLimitRule; guest: RateLimitRule; guestIp: RateLimitRule };
  maxBytes: number;
  logger: FastifyBaseLogger;
};

/**
 * Speech-to-text as a short request (blueprint §12, ADR-016). The recording is
 * verified, sent to the provider once, and wiped from memory; it is never
 * stored or logged, and neither is the transcript.
 */
export class TranscriptionService {
  readonly #deps: TranscriptionServiceDeps;

  constructor(deps: TranscriptionServiceDeps) {
    this.#deps = deps;
  }

  get enabled(): boolean {
    return this.#deps.provider !== null && this.#deps.provider.models().length > 0;
  }

  status(): AudioStatus {
    return {
      transcription: {
        enabled: this.enabled,
        maxBytes: this.#deps.maxBytes,
        maxDurationSeconds: RECORDING_MAX_SECONDS,
        mimeTypes: [...AUDIO_MIME_TYPES],
      },
      speech: { mode: 'browser' },
    };
  }

  /** Checks before the recording is read. @throws AppError MODEL_UNAVAILABLE or RATE_LIMITED */
  async begin(subject: TranscriptionSubject): Promise<void> {
    this.#assertEnabled();
    const { rateLimiter, rules } = this.#deps;
    if (subject.kind === 'user') {
      await rateLimiter.consume(rules.user, `user:${subject.userId}`);
    } else {
      await rateLimiter.consume(rules.guest, `guest:${subject.guestId}`);
      await rateLimiter.consume(rules.guestIp, subject.ipHash);
    }
  }

  async transcribe(
    subject: TranscriptionSubject,
    input: { bytes: Uint8Array; declaredType: string; language?: string; signal?: AbortSignal },
  ): Promise<TranscriptionResponse> {
    const { logger, maxBytes } = this.#deps;
    const { bytes } = input;
    const startedAt = performance.now();
    try {
      const provider = this.#assertEnabled();
      if (bytes.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'The recording is empty.');
      }
      if (bytes.length > maxBytes) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Recordings can be at most ${Math.floor(maxBytes / 1_048_576)} MB.`,
          { statusCode: 413 },
        );
      }
      const audio = sniffAudio(bytes);
      if (!audio) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Only WebM, Ogg, MP4, MP3, WAV and FLAC recordings are supported.',
          { statusCode: 415 },
        );
      }
      if (!audioTypeMatches(input.declaredType, audio.mimeType)) {
        throw new AppError('VALIDATION_ERROR', "The recording's content does not match its type.", {
          statusCode: 415,
        });
      }

      const model = provider.models()[0] as { id: string };
      const timeout = AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS);
      let result;
      try {
        result = await provider.transcribe({
          model: model.id,
          audio: bytes,
          mimeType: audio.mimeType,
          fileName: `recording.${audio.extension}`,
          ...(input.language ? { language: input.language } : {}),
          signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
        });
      } catch (error) {
        if (timeout.aborted) {
          throw new AppError(
            'PROVIDER_TIMEOUT',
            'Transcription took too long. Try a shorter recording.',
            { cause: error },
          );
        }
        throw error;
      }

      const text = result.text.trim();
      if (!text) {
        throw new AppError(
          'VALIDATION_ERROR',
          'No speech was recognized. Try again closer to the microphone.',
        );
      }
      // Sizes and timings only: never the transcript (blueprint §13).
      logger.info(
        {
          event: 'audio.transcribed',
          subject: subject.kind,
          provider: provider.id,
          model: model.id,
          sizeBytes: bytes.length,
          durationMs: result.durationMs,
          latencyMs: Math.round(performance.now() - startedAt),
        },
        'recording transcribed',
      );
      return {
        transcript: {
          text,
          language: result.language,
          durationMs: result.durationMs,
          provider: provider.id,
          model: model.id,
        },
      };
    } finally {
      // The recording is not kept anywhere, not even in this process's memory.
      bytes.fill(0);
    }
  }

  #assertEnabled(): TranscriptionProvider {
    const { provider } = this.#deps;
    if (!provider || !this.enabled) {
      throw new AppError('MODEL_UNAVAILABLE', 'Voice input is not enabled on this deployment.', {
        retryable: false,
      });
    }
    return provider;
  }
}
