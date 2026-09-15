import type { AIChatRequest, AIProvider, AIResponse, AIStreamChunk } from '@a-ai/ai-core';
import type { AIModel } from '@a-ai/shared-types';

export type ScriptStep =
  | AIStreamChunk
  | { type: 'wait'; ms: number }
  | { type: 'throw'; error: unknown }
  /** Waits until the request is aborted, then rethrows the abort reason. */
  | { type: 'hang' };

export function testModel(provider: string, id: string, overrides: Partial<AIModel> = {}): AIModel {
  return {
    id,
    provider,
    name: `${provider} ${id}`,
    category: 'text',
    contextWindow: 32_000,
    maxOutputTokens: 8_000,
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: false,
    availability: 'free',
    inputPricePerMillionUsd: null,
    outputPricePerMillionUsd: null,
    ...overrides,
  };
}

/**
 * A provider that plays back scripted chunks. Each call to `stream` consumes
 * the next script (the last one repeats), and every request is recorded.
 */
export class ScriptedProvider implements AIProvider {
  readonly id: string;
  readonly requests: AIChatRequest[] = [];
  #scripts: ScriptStep[][];

  constructor(id: string, ...scripts: ScriptStep[][]) {
    this.id = id;
    this.#scripts = scripts.length > 0 ? scripts : [[{ type: 'done', finishReason: 'stop' }]];
  }

  setScripts(...scripts: ScriptStep[][]): void {
    this.#scripts = scripts;
  }

  async getModels(): Promise<AIModel[]> {
    return [];
  }

  async chat(): Promise<AIResponse> {
    throw new Error('ScriptedProvider.chat is not used by the chat service');
  }

  async *stream(request: AIChatRequest): AsyncGenerator<AIStreamChunk> {
    this.requests.push(request);
    const script =
      this.#scripts.length > 1 ? (this.#scripts.shift() as ScriptStep[]) : (this.#scripts[0] ?? []);

    for (const step of script) {
      if (request.signal?.aborted) throw request.signal.reason;
      if (step.type === 'wait') {
        await new Promise((resolve) => setTimeout(resolve, step.ms));
      } else if (step.type === 'throw') {
        throw step.error;
      } else if (step.type === 'hang') {
        await new Promise((_resolve, reject) => {
          if (request.signal?.aborted) reject(request.signal.reason);
          request.signal?.addEventListener('abort', () => reject(request.signal?.reason), {
            once: true,
          });
        });
      } else {
        yield step;
      }
    }
  }
}
