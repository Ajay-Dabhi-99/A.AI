import { isAIProviderError } from '@a-ai/ai-core';

/** Deterministic retry and fallback rules for chat (blueprint §16 Phase 6, ADR-013). */

export type RetryPolicy = {
  /** Attempts on the model the user chose, including the first. Fallback models get one. */
  maxAttemptsPerModel: number;
  /** Wait before retrying a timeout or a transient provider outage. */
  backoffMs: number;
  /** Wait before retrying a 429 that sent no Retry-After. */
  rateLimitDelayMs: number;
  /** A 429 asking to wait longer than this is not retried on the same model. */
  maxRetryAfterMs: number;
  /** Other models tried after the chosen one fails. */
  maxFallbackModels: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttemptsPerModel: 2,
  backoffMs: 500,
  rateLimitDelayMs: 1_000,
  maxRetryAfterMs: 3_000,
  maxFallbackModels: 2,
};

export type FailureDecision = {
  /** Try the same model again after `delayMs`. */
  retry: { delayMs: number } | null;
  /** Another model may answer instead. */
  fallback: boolean;
  /** The failure says something about the provider's health (counts towards its circuit). */
  providerFault: boolean;
};

const GIVE_UP: FailureDecision = { retry: null, fallback: false, providerFault: false };

/**
 * | Failure (before any text)                    | Retry same model            | Fall back | Provider fault |
 * | -------------------------------------------- | --------------------------- | --------- | -------------- |
 * | PROVIDER_TIMEOUT                             | yes, after backoff          | yes       | yes            |
 * | RATE_LIMITED, Retry-After ≤ limit (or none)  | yes, after Retry-After      | yes       | yes            |
 * | RATE_LIMITED, Retry-After above the limit    | no                          | yes       | yes            |
 * | MODEL_UNAVAILABLE, retryable (5xx, network)  | yes, after backoff          | yes       | yes            |
 * | MODEL_UNAVAILABLE, not retryable (401/403/404)| no                         | yes       | yes            |
 * | PROVIDER_BAD_RESPONSE                        | no                          | yes       | yes            |
 * | anything else (unexpected errors, aborts)    | no                          | no        | no             |
 *
 * After any text has streamed, nothing is retried and nothing falls back: the
 * user has already seen part of this model's answer.
 */
export function decideAfterFailure(
  error: unknown,
  input: {
    attemptsOnModel: number;
    maxAttempts: number;
    producedText: boolean;
    policy: RetryPolicy;
  },
): FailureDecision {
  if (!isAIProviderError(error)) return GIVE_UP;
  const { attemptsOnModel, maxAttempts, producedText, policy } = input;
  const canRetry = !producedText && attemptsOnModel < maxAttempts;
  const fallback = !producedText;

  switch (error.code) {
    case 'PROVIDER_TIMEOUT':
      return {
        retry: canRetry ? { delayMs: policy.backoffMs } : null,
        fallback,
        providerFault: true,
      };
    case 'RATE_LIMITED': {
      const delayMs =
        error.retryAfterSeconds === undefined
          ? policy.rateLimitDelayMs
          : error.retryAfterSeconds * 1_000;
      return {
        retry: canRetry && delayMs <= policy.maxRetryAfterMs ? { delayMs } : null,
        fallback,
        providerFault: true,
      };
    }
    case 'MODEL_UNAVAILABLE':
      return {
        retry: canRetry && error.retryable ? { delayMs: policy.backoffMs } : null,
        fallback,
        providerFault: true,
      };
    case 'PROVIDER_BAD_RESPONSE':
      return { retry: null, fallback, providerFault: true };
    default:
      return GIVE_UP;
  }
}

/** Waits `ms`, or rejects with the abort reason as soon as `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
