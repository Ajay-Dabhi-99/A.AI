/**
 * Image generation extension point (Phase 8, ADR-015 §6). No adapter ships in
 * this phase; a provider with image quota implements this interface and is
 * registered in the API container.
 */

export type ImageModel = {
  provider: string;
  id: string;
  name: string;
};

export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  /** Aborting cancels the upstream call; adapters must honour it. */
  signal?: AbortSignal;
};

export type GeneratedImage = {
  /** Declared by the provider; the API verifies the bytes itself. */
  mimeType: string;
  data: Uint8Array;
};

export interface ImageGenerationProvider {
  /** Stable identifier, e.g. "openrouter". */
  readonly id: string;
  models(): ImageModel[];
  /** @throws AIProviderError for provider failures. */
  generate(request: ImageGenerationRequest): Promise<GeneratedImage>;
}
