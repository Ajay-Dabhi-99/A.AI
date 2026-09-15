import type {
  GeneratedImage,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageModel,
} from '@a-ai/ai-core';

/** An image provider whose result each test decides. Never calls a real service. */
export class ScriptedImageProvider implements ImageGenerationProvider {
  readonly id = 'pixels';
  readonly requests: ImageGenerationRequest[] = [];
  #result: (request: ImageGenerationRequest) => Promise<GeneratedImage>;

  constructor(result: (request: ImageGenerationRequest) => Promise<GeneratedImage>) {
    this.#result = result;
  }

  models(): ImageModel[] {
    return [{ provider: 'pixels', id: 'pix-1', name: 'Pixels 1' }];
  }

  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    this.requests.push(request);
    return this.#result(request);
  }
}
