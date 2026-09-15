/** Speech-to-text and text-to-speech (Phase 9, docs/api/audio.md, ADR-016). */

export type AudioMimeType =
  'audio/webm' | 'audio/ogg' | 'audio/mp4' | 'audio/mpeg' | 'audio/wav' | 'audio/flac';

export type Transcript = {
  text: string;
  /** Detected language (ISO 639-1) when the provider reports it. */
  language: string | null;
  durationMs: number | null;
  provider: string;
  model: string;
};

/** POST /api/audio/transcriptions */
export type TranscriptionResponse = {
  transcript: Transcript;
};

/** GET /api/audio/status */
export type AudioStatus = {
  transcription: {
    /** False when no speech-to-text provider key is configured. */
    enabled: boolean;
    maxBytes: number;
    /** Longest recording the web app records before stopping on its own. */
    maxDurationSeconds: number;
    mimeTypes: AudioMimeType[];
  };
  /** Text-to-speech runs in the browser (Web Speech API); the server stores no audio. */
  speech: { mode: 'browser' };
};
