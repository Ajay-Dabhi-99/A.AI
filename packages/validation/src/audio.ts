import type {
  AudioMimeType,
  AudioStatus,
  Transcript,
  TranscriptionResponse,
} from '@a-ai/shared-types';
import { z } from 'zod';

export const AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/flac',
] as const satisfies readonly AudioMimeType[];

/** The web app stops recording on its own after this long. */
export const RECORDING_MAX_SECONDS = 120;

export const transcriptSchema = z.object({
  text: z.string(),
  language: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  provider: z.string(),
  model: z.string(),
}) satisfies z.ZodType<Transcript>;

export const transcriptionResponseSchema = z.object({
  transcript: transcriptSchema,
}) satisfies z.ZodType<TranscriptionResponse>;

export const audioStatusSchema = z.object({
  transcription: z.object({
    enabled: z.boolean(),
    maxBytes: z.number().int().nonnegative(),
    maxDurationSeconds: z.number().int().positive(),
    mimeTypes: z.array(z.enum(AUDIO_MIME_TYPES)),
  }),
  speech: z.object({ mode: z.literal('browser') }),
}) satisfies z.ZodType<AudioStatus>;

/** POST /api/audio/transcriptions?language=xx */
export const transcriptionQuerySchema = z.object({
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/, 'Use a two-letter language code, for example "en"')
    .optional(),
});
