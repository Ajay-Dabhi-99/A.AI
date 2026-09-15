import type {
  GeneratedMedia,
  MediaGenerationProvider,
  MediaGenerationRequest,
  MediaModel,
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResult,
} from '@a-ai/ai-core';

/** A generation provider whose result each test decides. Never calls a real service. */
export class ScriptedMediaProvider implements MediaGenerationProvider {
  readonly id: string;
  readonly requests: MediaGenerationRequest[] = [];
  readonly #models: MediaModel[];
  #result: (request: MediaGenerationRequest) => Promise<GeneratedMedia>;

  constructor(
    id: string,
    models: MediaModel[],
    result: (request: MediaGenerationRequest) => Promise<GeneratedMedia>,
  ) {
    this.id = id;
    this.#models = models;
    this.#result = result;
  }

  models(): MediaModel[] {
    return this.#models;
  }

  async generate(request: MediaGenerationRequest): Promise<GeneratedMedia> {
    this.requests.push(request);
    return this.#result(request);
  }
}

/** Image model `pixels/pix-1`. */
export class ScriptedImageProvider extends ScriptedMediaProvider {
  constructor(result: (request: MediaGenerationRequest) => Promise<GeneratedMedia>) {
    super('pixels', [{ provider: 'pixels', id: 'pix-1', name: 'Pixels 1' }], result);
  }
}

/** Video model `reels/reel-1`. */
export class ScriptedVideoProvider extends ScriptedMediaProvider {
  constructor(result: (request: MediaGenerationRequest) => Promise<GeneratedMedia>) {
    super('reels', [{ provider: 'reels', id: 'reel-1', name: 'Reels 1' }], result);
  }
}

/** A speech-to-text provider that records requests and answers as scripted. */
export class ScriptedTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'groq';
  readonly requests: (Omit<TranscriptionRequest, 'audio'> & { audio: Uint8Array })[] = [];
  #result: (request: TranscriptionRequest) => Promise<TranscriptionResult>;

  constructor(result: (request: TranscriptionRequest) => Promise<TranscriptionResult>) {
    this.#result = result;
  }

  models(): MediaModel[] {
    return [{ provider: 'groq', id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo' }];
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    // A copy: the service wipes the original buffer after the call.
    this.requests.push({ ...request, audio: new Uint8Array(request.audio) });
    return this.#result(request);
  }
}
