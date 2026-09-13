import { DEFAULT_RETRYABLE, type ErrorCode, type ValidationIssue } from '@a-ai/shared-types';

export const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  MODEL_UNAVAILABLE: 503,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_BAD_RESPONSE: 502,
  CONTEXT_TOO_LARGE: 422,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export type AppErrorOptions = {
  retryable?: boolean;
  statusCode?: number;
  details?: ValidationIssue[];
  cause?: unknown;
};

/**
 * An error whose message is safe to show the client. Services throw this;
 * anything else that reaches the error handler is reported as INTERNAL_ERROR.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly details: ValidationIssue[] | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = options.statusCode ?? HTTP_STATUS_BY_CODE[code];
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[code];
    this.details = options.details;
  }
}
