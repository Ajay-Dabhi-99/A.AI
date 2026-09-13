import { DEFAULT_RETRYABLE, type ErrorCode } from '@a-ai/shared-types';

export type AIProviderErrorOptions = {
  provider: string;
  code: ErrorCode;
  /** Safe to show a user. Must never include keys, URLs with secrets or raw bodies. */
  message: string;
  retryable?: boolean;
  /** Upstream HTTP status, when there was one. */
  status?: number;
  /** Seconds the provider asked us to wait (Retry-After), when known. */
  retryAfterSeconds?: number;
  cause?: unknown;
};

/**
 * The single error type adapters throw. The API maps it to its HTTP error
 * envelope; comparison runs map it to a per-column error card.
 */
export class AIProviderError extends Error {
  readonly provider: string;
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(options: AIProviderErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AIProviderError';
    this.provider = options.provider;
    this.code = options.code;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[options.code];
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isAIProviderError(error: unknown): error is AIProviderError {
  return error instanceof AIProviderError;
}
