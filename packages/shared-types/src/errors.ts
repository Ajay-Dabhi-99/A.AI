/**
 * Application error taxonomy (blueprint section 14, extended in Phase 1 for
 * authentication). Every failure that reaches a client is one of these codes,
 * regardless of which provider or layer failed.
 */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'TOKEN_INVALID',
  'FORBIDDEN',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'MODEL_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_BAD_RESPONSE',
  'CONTEXT_TOO_LARGE',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Default retry guidance per code. Individual errors may override it (for
 * example MODEL_UNAVAILABLE caused by a bad provider key is not retryable).
 */
export const DEFAULT_RETRYABLE: Readonly<Record<ErrorCode, boolean>> = {
  AUTH_REQUIRED: false,
  INVALID_CREDENTIALS: false,
  EMAIL_NOT_VERIFIED: false,
  TOKEN_INVALID: false,
  FORBIDDEN: false,
  QUOTA_EXCEEDED: false,
  RATE_LIMITED: true,
  MODEL_UNAVAILABLE: true,
  PROVIDER_TIMEOUT: true,
  PROVIDER_BAD_RESPONSE: false,
  CONTEXT_TOO_LARGE: false,
  VALIDATION_ERROR: false,
  NOT_FOUND: false,
  INTERNAL_ERROR: false,
};

export type ValidationIssue = {
  path: string;
  message: string;
};

/** The only error body shape the API ever returns. */
export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    requestId: string;
    details?: ValidationIssue[];
  };
};
