import { isAIProviderError } from '@a-ai/ai-core';
import type { ApiErrorBody, ValidationIssue } from '@a-ai/shared-types';
import { ZodError } from 'zod';
import { AppError, HTTP_STATUS_BY_CODE } from './app-error.js';

export type NormalizedError = {
  statusCode: number;
  body: ApiErrorBody;
  headers: Record<string, string>;
  /** True for failures we did not anticipate; these are logged at error level. */
  unexpected: boolean;
};

type FastifyLikeError = Error & {
  statusCode?: number;
  code?: string;
  validation?: { instancePath?: string; message?: string }[];
};

const INTERNAL_MESSAGE = 'Something went wrong on our side. Please try again.';

function body(
  code: ApiErrorBody['error']['code'],
  message: string,
  retryable: boolean,
  requestId: string,
  details?: ValidationIssue[],
): ApiErrorBody {
  return { error: { code, message, retryable, requestId, ...(details ? { details } : {}) } };
}

/**
 * Converts any thrown value into the single client-facing error envelope.
 * Only messages we authored (AppError, AIProviderError, Fastify 4xx) are
 * forwarded; unknown errors never leak their message or stack.
 */
export function toApiError(error: unknown, requestId: string): NormalizedError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: body(error.code, error.message, error.retryable, requestId, error.details),
      headers:
        error.retryAfterSeconds === undefined
          ? {}
          : { 'retry-after': String(error.retryAfterSeconds) },
      unexpected: false,
    };
  }

  if (isAIProviderError(error)) {
    return {
      statusCode: HTTP_STATUS_BY_CODE[error.code],
      body: body(error.code, error.message, error.retryable, requestId),
      headers:
        error.retryAfterSeconds === undefined
          ? {}
          : { 'retry-after': String(error.retryAfterSeconds) },
      unexpected: false,
    };
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return {
      statusCode: 400,
      body: body('VALIDATION_ERROR', 'The request is invalid.', false, requestId, details),
      headers: {},
      unexpected: false,
    };
  }

  const fastifyError = error as FastifyLikeError;
  if (Array.isArray(fastifyError?.validation)) {
    const details = fastifyError.validation.map((issue) => ({
      path: (issue.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.'),
      message: issue.message ?? 'is invalid',
    }));
    return {
      statusCode: 400,
      body: body('VALIDATION_ERROR', 'The request is invalid.', false, requestId, details),
      headers: {},
      unexpected: false,
    };
  }

  const status = fastifyError?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    if (status === 404) {
      return {
        statusCode: 404,
        body: body('NOT_FOUND', 'Not found.', false, requestId),
        headers: {},
        unexpected: false,
      };
    }
    if (status === 429) {
      return {
        statusCode: 429,
        body: body('RATE_LIMITED', 'Too many requests. Please slow down.', true, requestId),
        headers: {},
        unexpected: false,
      };
    }
    // Fastify's own 4xx messages (bad JSON, unsupported media type, body too large) are safe.
    return {
      statusCode: status,
      body: body('VALIDATION_ERROR', fastifyError.message, false, requestId),
      headers: {},
      unexpected: false,
    };
  }

  return {
    statusCode: 500,
    body: body('INTERNAL_ERROR', INTERNAL_MESSAGE, false, requestId),
    headers: {},
    unexpected: true,
  };
}
