/**
 * Media extension points (Phases 8–9, ADR-015 §6, ADR-016). Image and video
 * generation share one job contract; speech-to-text is a short request. No
 * generation adapter ships yet; a provider implements these interfaces and is
 * registered in the API container.
 */

export type MediaModel = {
  provider: string;
  id: string;
  name: string;
};

export type MediaGenerationRequest = {
  model: string;
  prompt: string;
  /** Aborting cancels the upstream call; adapters must honour it. */
  signal?: AbortSignal;
  /** Called with 0–1 as the provider reports progress. Optional for providers. */
  onProgress?: (fraction: number) => void;
};

export type GeneratedMedia = {
  /** Declared by the provider; the API verifies the bytes itself. */
  mimeType: string;
  data: Uint8Array;
};

export interface MediaGenerationProvider {
  /** Stable identifier, e.g. "openrouter". */
  readonly id: string;
  models(): MediaModel[];
  /** @throws AIProviderError for provider failures. */
  generate(request: MediaGenerationRequest): Promise<GeneratedMedia>;
}

export type ImageModel = MediaModel;
export type ImageGenerationRequest = MediaGenerationRequest;
export type GeneratedImage = GeneratedMedia;
export type ImageGenerationProvider = MediaGenerationProvider;
export type VideoGenerationProvider = MediaGenerationProvider;

export type TranscriptionRequest = {
  model: string;
  audio: Uint8Array;
  /** The verified container type, e.g. "audio/webm". */
  mimeType: string;
  fileName: string;
  /** ISO 639-1 hint; the provider detects the language when absent. */
  language?: string;
  signal?: AbortSignal;
};

export type TranscriptionResult = {
  text: string;
  language: string | null;
  durationMs: number | null;
};

export interface TranscriptionProvider {
  readonly id: string;
  models(): MediaModel[];
  /** @throws AIProviderError for provider failures. */
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}
