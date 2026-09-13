import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, NetworkError } from '@/services/api';

/**
 * Puts server validation messages on the matching fields and returns the
 * message for everything else (or null when every issue landed on a field).
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (error instanceof ApiError) {
    const unmatched = error.details.filter((issue) => {
      const field = fields.find((name) => name === issue.path);
      if (field) setError(field, { type: 'server', message: issue.message });
      return !field;
    });
    if (error.details.length > 0 && unmatched.length === 0) return null;
    return error.message;
  }
  if (error instanceof NetworkError) return error.message;
  return 'Something went wrong. Please try again.';
}

/** Reads `#token=...` from an emailed link. */
export function tokenFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token');
}

/** Only same-site paths, so a crafted ?next= cannot send users to another site. */
export function safeRedirectPath(value: string | null, fallback = '/settings'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}
