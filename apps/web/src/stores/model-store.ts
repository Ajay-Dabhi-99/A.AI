import type { AIModel } from '@a-ai/shared-types';
import { create } from 'zustand';

export type ModelRef = { provider: string; id: string };

const STORAGE_KEY = 'a-ai-model';

function readStored(): ModelRef | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (value && typeof value === 'object' && 'provider' in value && 'id' in value) {
      const { provider, id } = value as Record<string, unknown>;
      if (typeof provider === 'string' && typeof id === 'string') return { provider, id };
    }
  } catch {
    // unreadable or blocked storage: no remembered choice
  }
  return null;
}

type ModelState = {
  selected: ModelRef | null;
  select: (model: ModelRef) => void;
};

/** The model the user last picked, remembered in this browser (blueprint §3: Zustand for model selection). */
export const useModelStore = create<ModelState>()((set) => ({
  selected: readStored(),
  select: (model) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    } catch {
      // storage blocked: remember for this page only
    }
    set({ selected: model });
  },
}));

/** The remembered model if it is still offered, otherwise the API's default. */
export function resolveModel(
  models: AIModel[],
  selected: ModelRef | null,
  fallback: ModelRef | null,
): AIModel | undefined {
  const find = (ref: ModelRef | null) =>
    ref
      ? models.find((model) => model.provider === ref.provider && model.id === ref.id)
      : undefined;
  return find(selected) ?? find(fallback) ?? models[0];
}
