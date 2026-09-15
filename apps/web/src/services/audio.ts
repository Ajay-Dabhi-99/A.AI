import type { AudioStatus, TranscriptionResponse } from '@a-ai/shared-types';
import { audioStatusSchema, transcriptionResponseSchema } from '@a-ai/validation';
import { apiRequest, apiUpload } from './api';

export const fetchAudioStatus = (signal?: AbortSignal): Promise<AudioStatus> =>
  apiRequest('/api/audio/status', { schema: audioStatusSchema, ...(signal ? { signal } : {}) });

/** POST /api/audio/transcriptions: the recording is transcribed and discarded by the API. */
export function transcribeAudio(file: File, signal?: AbortSignal): Promise<TranscriptionResponse> {
  const form = new FormData();
  form.append('file', file, file.name);
  return apiUpload('/api/audio/transcriptions', form, {
    schema: transcriptionResponseSchema,
    ...(signal ? { signal } : {}),
  });
}
