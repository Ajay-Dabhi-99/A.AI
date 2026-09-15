import { isAIProviderError } from '@a-ai/ai-core';
import type { RunError } from '@a-ai/shared-types';
import { AppError } from '../shared/errors/app-error.js';

export const GENERIC_RUN_FAILURE = 'Something went wrong while answering. Please try again.';

/**
 * The error a stream reports for one failed run. Provider and application
 * errors carry messages that are safe to show; anything else is reported as
 * INTERNAL_ERROR without its message, after `onUnexpected` has logged it.
 */
export function toRunError(error: unknown, onUnexpected: (error: unknown) => void): RunError {
  if (isAIProviderError(error) || error instanceof AppError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  onUnexpected(error);
  return { code: 'INTERNAL_ERROR', message: GENERIC_RUN_FAILURE, retryable: true };
}
