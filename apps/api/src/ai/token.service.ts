import type { AIModel } from '@a-ai/shared-types';
import type { KeyValueStore } from '../services/kv-store.js';
import { CHARS_PER_TOKEN } from './context-builder.js';

/** The most cautious estimate calibration may produce (dense text such as code or non-Latin scripts). */
export const MIN_CHARS_PER_TOKEN = 2;
/** Short prompts are dominated by chat-template overhead and say little about a tokenizer. */
export const CALIBRATION_MIN_CHARACTERS = 400;
/** Observations needed before a model's own ratio replaces the default. */
export const CALIBRATION_MIN_SAMPLES = 3;
const SMOOTHING = 0.2;
const CALIBRATION_TTL_MS = 30 * 24 * 3_600_000;

export type TokenCalibration = { ratio: number; samples: number };

/** Exponential moving average of observed characters per token. */
export function nextCalibration(
  previous: TokenCalibration | null,
  observedRatio: number,
): TokenCalibration {
  if (!previous) return { ratio: observedRatio, samples: 1 };
  return {
    ratio: previous.ratio + SMOOTHING * (observedRatio - previous.ratio),
    samples: previous.samples + 1,
  };
}

/**
 * Characters per token to estimate with. Calibration can only make estimates
 * more cautious than the default (never above CHARS_PER_TOKEN), so a model
 * whose tokenizer is denser than 4 characters per token stops being
 * underestimated, and a lighter one is still budgeted conservatively.
 */
export function effectiveCharsPerToken(calibration: TokenCalibration | null): number {
  if (
    !calibration ||
    calibration.samples < CALIBRATION_MIN_SAMPLES ||
    !Number.isFinite(calibration.ratio)
  ) {
    return CHARS_PER_TOKEN;
  }
  return Math.min(CHARS_PER_TOKEN, Math.max(MIN_CHARS_PER_TOKEN, calibration.ratio));
}

function isCalibration(value: unknown): value is TokenCalibration {
  const candidate = value as Partial<TokenCalibration> | null;
  return (
    typeof candidate?.ratio === 'number' &&
    Number.isFinite(candidate.ratio) &&
    candidate.ratio > 0 &&
    typeof candidate.samples === 'number'
  );
}

/**
 * Per-model token estimation (blueprint §10: "the selected model tokenizer or
 * provider token count mechanism"). No provider here publishes a tokenizer
 * usable in Node for every model, so the provider's exact input count after
 * each call calibrates the estimate for that model. Stored in Redis so every
 * API instance shares what was learned.
 */
export class TokenService {
  readonly #store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.#store = store;
  }

  async charsPerToken(model: Pick<AIModel, 'provider' | 'id'>): Promise<number> {
    const stored = await this.#store.getJson<unknown>(this.#key(model));
    return effectiveCharsPerToken(isCalibration(stored) ? stored : null);
  }

  /** Learns from the provider's exact input count for a prompt of `characters` characters. */
  async record(
    model: Pick<AIModel, 'provider' | 'id'>,
    characters: number,
    inputTokens: number,
  ): Promise<void> {
    if (characters < CALIBRATION_MIN_CHARACTERS || !(inputTokens > 0)) return;
    const key = this.#key(model);
    const stored = await this.#store.getJson<unknown>(key);
    const next = nextCalibration(isCalibration(stored) ? stored : null, characters / inputTokens);
    await this.#store.setJson(key, next, CALIBRATION_TTL_MS);
  }

  #key(model: Pick<AIModel, 'provider' | 'id'>): string {
    return `tokens:ratio:${model.provider}:${model.id}`;
  }
}
